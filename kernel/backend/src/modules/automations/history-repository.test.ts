import { expect, it } from "@effect/vitest";
import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryNotFound,
	AutomationHistoryRequestError,
	AutomationHistoryRetryConflict,
} from "@ryot-app/contract/modules/automations/history-schemas";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationRunId,
	PluginId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { assert, describe } from "vitest";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import {
	automationRun,
	automationRunAttempt,
	automationTrigger,
} from "#lib/infrastructure/db/schema/tables/automations";
import {
	sandboxScript,
	plugin,
	pluginRevision,
	pluginConfigRevision,
	pluginConfigEncryptionKey,
} from "#lib/infrastructure/db/schema/tables/core";
import { Database, DatabaseLive, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { fixtureManifest } from "#modules/plugins/test-support";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationExecutionOperations } from "./execution";
import { AutomationHistoryRepository } from "./history-repository";
import { AutomationHistoryService } from "./history-service";
import { AutomationTriggerRepository } from "./trigger-repository";

const now = new Date(0);
const owner = {
	image: null,
	name: "Owner",
	id: UserId.make("owner"),
	email: "owner@example.com",
	preferences: defaultUserPreferences,
};
const other = { ...owner, id: UserId.make("other") };

const withDatabase = <E>(
	test: Effect.Effect<void, E, Database | AutomationHistoryService>,
	submit?: AutomationExecutionOperations["Service"]["submit"],
) => {
	const name = `history_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const url = testDatabaseUrl();
	const layer = DatabaseLive.pipe(
		Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
	);
	return Effect.gen(function* () {
		const root = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
		yield* root.execute(sql`create database ${sql.identifier(name)}`);
		yield* Effect.gen(function* () {
			const scopedUrl = new URL(url);
			scopedUrl.pathname = `/${name}`;
			const database = DatabaseLive.pipe(
				Layer.provide(
					makeAppConfigLayer({ database: { url: Redacted.make(scopedUrl.toString()) } }),
				),
				Layer.fresh,
			);
			const execution = Layer.succeed(
				AutomationExecutionOperations,
				AutomationExecutionOperations.of({
					execute: () => Effect.die("unused"),
					submit: submit ?? (() => Effect.void),
					skipQueuedPolicies: () => Effect.void,
				}),
			);
			const services = AutomationHistoryService.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						database,
						execution,
						AutomationHistoryRepository.layer,
						AutomationAttemptRepository.layer,
						AutomationTriggerRepository.layer,
					),
				),
			);
			yield* Effect.gen(function* () {
				const db = yield* Database;
				for (const statement of ddl.split("--> statement-breakpoint")) {
					yield* db.execute(sql.raw(statement));
				}
				yield* db.insert(user).values([
					{ id: owner.id, preferences: {}, name: owner.name, email: owner.email },
					{ id: other.id, name: "Other", preferences: {}, email: "other@example.com" },
				]);
				yield* db
					.insert(automationTrigger)
					.values({
						depth: 0,
						id: "trigger",
						source: "api",
						occurredAt: now,
						operation: "emit",
						category: "signal",
						resourceKind: "signal",
						executionId: "command",
						initiatorKind: "system",
						rootExecutionId: "command",
						payload: {
							operation: "emit",
							actorUserId: null,
							category: "signal",
							resource: "signal",
							signalSchemaPluginId: null,
							properties: { password: "hidden-without-schema" },
							signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
						},
					});
				yield* db
					.insert(sandboxScript)
					.values({
						id: "script",
						name: "Notify",
						contentHash: "hash",
						slug: "kernel.notify",
						source: "private-source",
						compiledCode: "private-code",
						metadata: {
							name: "Notify",
							capabilities: [],
							kind: "automation",
							slug: "kernel.notify",
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
					});
				yield* test;
			}).pipe(Effect.provide(Layer.merge(database, services)));
		}).pipe(
			Effect.ensuring(root.execute(sql`drop database ${sql.identifier(name)}`).pipe(Effect.orDie)),
		);
	}).pipe(Effect.provide(layer.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

const seedRun = (
	id: string,
	executionUserId: UserId | null = owner.id,
	stage: "before" | "after" = "after",
) =>
	Effect.gen(function* () {
		const db = yield* Database;
		yield* db
			.insert(automationRun)
			.values({
				id,
				stage,
				hookName: id,
				hookSlug: id,
				queuedAt: now,
				startedAt: now,
				attemptCount: 1,
				executionUserId,
				finishedAt: now,
				status: "failed",
				triggerId: "trigger",
				sandboxScriptId: "script",
				scriptContentHash: "hash",
				scriptSlug: "kernel.notify",
				delivery: stage === "before" ? "policy" : "async",
				retryPolicy: stage === "before" ? null : DEFAULT_AUTOMATION_RETRY_POLICY,
				artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-16T00:00:00.000Z")),
			});
	});

describe("bounded automation HTTP history persistence", () => {
	it.effect(
		"paginates equal timestamps without duplicates and scopes every cursor/filter to the owner",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seedRun("run-a");
					yield* seedRun("run-b");
					yield* seedRun("run-c");
					yield* seedRun("run-z", other.id);
					yield* seedRun("system", null);
					const db = yield* Database;
					yield* db.execute(
						sql`update automation_run set queued_at = '1970-01-01T00:00:00.000001Z'::timestamptz where id in ('run-a', 'run-b', 'run-c')`,
					);
					const service = yield* AutomationHistoryService;
					const first = yield* service.listRuns(owner, { limit: 2 });
					expect(first.items.map(({ id }) => id)).toEqual(["run-c", "run-b"]);
					assert(first.nextCursor !== null);
					const second = yield* service.listRuns(owner, { limit: 2, cursor: first.nextCursor });
					expect(second.items.map(({ id }) => id)).toEqual(["run-a"]);
					expect(second.nextCursor).toBeNull();
					expect(
						(yield* service.listRuns(other, { cursor: first.nextCursor })).items.map(
							({ id }) => id,
						),
					).toEqual(["run-z"]);
					expect((yield* service.listRuns(owner, { status: "running" })).items).toEqual([]);
					expect(
						(yield* service.listRuns(owner, {
							stage: "after",
							status: "failed",
							from: "1970-01-01T00:00:00Z",
							to: "1970-01-01T00:00:00.001Z",
							hookSlug: first.items[0]?.hookSlug,
						})).items.map(({ id }) => id),
					).toEqual(["run-c"]);
					assertExitFails(
						yield* service
							.listRuns(owner, { to: "1970-01-01T00:00:00Z", from: "1970-01-02T00:00:00Z" })
							.pipe(Effect.exit),
						new AutomationHistoryRequestError({ reason: { code: "invalid-filters" } }),
					);
					for (const limit of [0, 101, 1.5]) {
						assertExitFails(
							yield* service.listRuns(owner, { limit }).pipe(Effect.exit),
							new AutomationHistoryRequestError({ reason: { code: "invalid-filters" } }),
						);
					}
					assertExitFails(
						yield* service.listRuns(owner, { cursor: "!" }).pipe(Effect.exit),
						new AutomationHistoryRequestError({ reason: { code: "invalid-cursor" } }),
					);
				}),
			),
	);

	it.effect("denies foreign detail and retry before artifact reads or queueing", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seedRun("run");
				const service = yield* AutomationHistoryService;
				const runId = AutomationRunId.make("run");
				assertExitFails(
					yield* service.getRun(other, runId).pipe(Effect.exit),
					new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } }),
				);
				assertExitFails(
					yield* service.retryRun(other, runId, { expectedAttemptCount: 1 }).pipe(Effect.exit),
					new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } }),
				);
				const db = yield* Database;
				const [stored] = yield* db.select().from(automationRun).where(eq(automationRun.id, runId));
				expect(stored?.status).toBe("failed");
			}),
			() => Effect.die("Unauthorized retry dispatched"),
		),
	);

	it.effect(
		"queues the same owned run before submission and preserves pending work if dispatch fails",
		() => {
			const submissions: string[] = [];
			let verifyCommitted: Effect.Effect<void, DbError> = Effect.die(
				"Submission before test setup",
			);
			return withDatabase(
				Effect.gen(function* () {
					yield* seedRun("run");
					const service = yield* AutomationHistoryService;
					const db = yield* Database;
					verifyCommitted = mapDatabaseErrors(
						db
							.select({ status: automationRun.status })
							.from(automationRun)
							.where(eq(automationRun.id, "run")),
					).pipe(
						Effect.map(([row]) => {
							expect(row?.status).toBe("queued");
						}),
					);
					const result = yield* service.retryRun(owner, AutomationRunId.make("run"), {
						expectedAttemptCount: 1,
					});
					expect(result).toEqual({ runId: "run", attemptNumber: 2, dispatch: "pending" });
					expect(submissions).toEqual(["run:2"]);
					const [stored] = yield* db
						.select()
						.from(automationRun)
						.where(eq(automationRun.id, "run"));
					expect(stored).toMatchObject({
						attemptCount: 1,
						status: "queued",
						sandboxScriptId: "script",
						scriptContentHash: "hash",
						scriptSlug: "kernel.notify",
					});
					assertExitFails(
						yield* service
							.retryRun(owner, AutomationRunId.make("run"), { expectedAttemptCount: 1 })
							.pipe(Effect.exit),
						new AutomationHistoryRetryConflict({
							reason: { code: "not-failed", runId: AutomationRunId.make("run") },
						}),
					);
				}),
				({ runId, attemptNumber }) =>
					verifyCommitted.pipe(
						Effect.andThen(
							Effect.sync(() => {
								submissions.push(`${runId}:${attemptNumber}`);
							}),
						),
						Effect.andThen(Effect.fail(new DbError({ message: "private-dispatch-error" }))),
					),
			);
		},
	);

	it.effect("rejects expired, before-policy and stale retries", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seedRun("expired");
				yield* seedRun("policy", owner.id, "before");
				yield* seedRun("stale");
				const db = yield* Database;
				yield* db
					.update(automationRun)
					.set({ artifactsExpireAt: now })
					.where(eq(automationRun.id, "expired"));
				const service = yield* AutomationHistoryService;
				for (const [id, count, code] of [
					["expired", 1, "expired"],
					["policy", 1, "before-policy"],
					["stale", 2, "retry-conflict"],
				] as const) {
					assertExitFails(
						yield* service
							.retryRun(owner, AutomationRunId.make(id), { expectedAttemptCount: count })
							.pipe(Effect.exit),
						new AutomationHistoryRetryConflict({
							reason: { code, runId: AutomationRunId.make(id) },
						}),
					);
				}
			}),
		),
	);

	it.effect(
		"returns only the latest bounded attempts and omits payload properties without a pinned schema",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seedRun("run");
					const db = yield* Database;
					yield* db
						.update(automationRun)
						.set({ attemptCount: 51 })
						.where(eq(automationRun.id, "run"));
					yield* db
						.insert(automationRunAttempt)
						.values(
							Array.from({ length: 51 }, (_, index) => ({
								error: null,
								runId: "run",
								startedAt: now,
								finishedAt: now,
								retryable: false,
								id: `attempt-${index}`,
								attemptNumber: index + 1,
								status: "failed" as const,
								returnedValue: { secret: "hidden" },
								workflowExecutionId: `workflow-${index}`,
								logs: [{ level: "info" as const, message: "token=hidden" }],
							})),
						);
					const service = yield* AutomationHistoryService;
					const detail = yield* service.getRun(owner, AutomationRunId.make("run"));
					expect(detail.attempts).toHaveLength(AUTOMATION_HISTORY_LIMITS.maxAttempts);
					expect(detail.attempts[0]?.attemptNumber).toBe(51);
					expect(detail.attemptsTruncated).toBe(true);
					expect(detail.trigger.payload).toMatchObject({ properties: {} });
					expect(detail.retryEligibility).toEqual({ reason: null });
					expect(stableStringify(detail)).not.toMatch(
						/private-source|private-code|hidden|returnedValue|workflowExecutionId|encryptedPayload/,
					);
				}),
			),
	);

	it.effect(
		"uses pinned schema redaction after revision changes and retries an inactive plugin only with its key",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seedRun("pinned");
					const db = yield* Database;
					const base = fixtureManifest();
					yield* db
						.insert(plugin)
						.values({ id: "plugin", slug: "fixture", scope: "system", status: "inactive" });
					yield* db.insert(pluginRevision).values([
						{
							version: "1",
							sourceHash: "old",
							pluginId: "plugin",
							id: "pinned-revision",
							manifest: {
								...base,
								metadata: { ...base.metadata, name: "Pinned name" },
								signalSchemas: base.signalSchemas.map((signal) => ({
									...signal,
									propertiesSchema: {
										fields: {
											visible: { type: "string", label: "Visible", description: "Visible field" },
											password: {
												secret: true,
												type: "string",
												label: "Password",
												description: "Secret field",
											},
										},
									},
								})),
							},
						},
						{
							version: "2",
							manifest: base,
							pluginId: "plugin",
							sourceHash: "current",
							id: "current-revision",
						},
					]);
					yield* db
						.update(plugin)
						.set({ activeRevisionId: "current-revision" })
						.where(eq(plugin.id, "plugin"));
					yield* db
						.insert(pluginConfigRevision)
						.values({
							id: "config",
							scope: "environment",
							encryptionKeyId: "key",
							nonce: Buffer.alloc(12),
							payloadFingerprint: "fingerprint",
							encryptedPayload: Buffer.alloc(16),
							pluginRevisionId: "pinned-revision",
						});
					yield* db
						.update(sandboxScript)
						.set({ pluginRevisionId: "pinned-revision" })
						.where(eq(sandboxScript.id, "script"));
					yield* db
						.update(automationRun)
						.set({
							pluginId: "plugin",
							pluginConfigRevisionId: "config",
							pluginRevisionId: "pinned-revision",
						})
						.where(eq(automationRun.id, "pinned"));
					yield* db
						.update(automationTrigger)
						.set({
							payload: {
								operation: "emit",
								actorUserId: null,
								category: "signal",
								resource: "signal",
								signalSchemaPluginId: PluginId.make("plugin"),
								properties: { visible: "kept", password: "hidden" },
								signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
							},
						})
						.where(eq(automationTrigger.id, "trigger"));
					const service = yield* AutomationHistoryService;
					const runId = AutomationRunId.make("pinned");
					const detail = yield* service.getRun(owner, runId);
					expect(detail.run.pluginName).toBe("Pinned name");
					expect(detail.trigger.payload).toMatchObject({ properties: { visible: "kept" } });
					expect(stableStringify(detail)).not.toContain("hidden");
					expect(detail.retryEligibility).toEqual({ reason: "missing-artifact" });
					assertExitFails(
						yield* service.retryRun(owner, runId, { expectedAttemptCount: 1 }).pipe(Effect.exit),
						new AutomationHistoryRetryConflict({ reason: { runId, code: "missing-artifact" } }),
					);
					yield* db.insert(pluginConfigEncryptionKey).values({ id: "key", key: Buffer.alloc(32) });
					expect(yield* service.retryRun(owner, runId, { expectedAttemptCount: 1 })).toEqual({
						runId,
						attemptNumber: 2,
						dispatch: "submitted",
					});
					const [stored] = yield* db
						.select()
						.from(automationRun)
						.where(eq(automationRun.id, runId));
					expect(stored).toMatchObject({
						sandboxScriptId: "script",
						pluginConfigRevisionId: "config",
						pluginRevisionId: "pinned-revision",
					});
				}),
			),
	);
	it.effect(
		"omits oversized retained payloads and preserves compact detail after payload pruning",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seedRun("large");
					const db = yield* Database;
					yield* db
						.update(automationTrigger)
						.set({
							payload: {
								properties: {},
								operation: "emit",
								category: "signal",
								resource: "signal",
								signalSchemaPluginId: null,
								signalSchemaSlug: SignalSchemaSlug.make("fixture.signal"),
								actorUserId: UserId.make("x".repeat(AUTOMATION_HISTORY_LIMITS.payloadBytes)),
							},
						})
						.where(eq(automationTrigger.id, "trigger"));
					const service = yield* AutomationHistoryService;
					const runId = AutomationRunId.make("large");
					expect((yield* service.getRun(owner, runId)).trigger).toMatchObject({
						payload: null,
						payloadTruncated: true,
					});
					yield* db
						.update(automationTrigger)
						.set({ payload: null, payloadPrunedAt: now })
						.where(eq(automationTrigger.id, "trigger"));
					const detail = yield* service.getRun(owner, runId);
					expect(detail.trigger).toMatchObject({
						payload: null,
						payloadTruncated: false,
						payloadPrunedAt: now.toISOString(),
					});
					expect(detail.run.id).toBe(runId);
					expect(detail.retryEligibility).toEqual({ reason: "missing-artifact" });
				}),
			),
	);
});
