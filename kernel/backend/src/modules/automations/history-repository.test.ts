import { expect, it } from "@effect/vitest";
import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryNotFound,
	AutomationHistoryRetryConflict,
} from "@ryot-app/contract/modules/automations/history-schemas";
import {
	AutomationRun,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationRunId,
	AutomationTriggerId,
	PluginId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Redacted, Schema } from "effect";
import { assert, describe } from "vitest";

import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { automationRun, automationTrigger } from "#lib/infrastructure/db/schema/tables/automations";
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
import { AutomationRunRepository } from "./run-repository";
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
	test: Effect.Effect<
		void,
		E,
		Database | AutomationHistoryService | AutomationRunRepository | AutomationTriggerRepository
	>,
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
			}).pipe(
				Effect.provide(
					Layer.mergeAll(
						database,
						services,
						AutomationRunRepository.layer,
						AutomationTriggerRepository.layer,
					),
				),
			);
		}).pipe(
			Effect.ensuring(root.execute(sql`drop database ${sql.identifier(name)}`).pipe(Effect.orDie)),
		);
	}).pipe(Effect.provide(layer.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

const seedRun = (
	id: string,
	executionUserId: UserId | null = owner.id,
	stage: "before" | "after" = "after",
	pin: {
		readonly pluginId: string;
		readonly pluginRevisionId: string;
		readonly pluginConfigRevisionId: string;
	} | null = null,
) =>
	Effect.gen(function* () {
		const db = yield* Database;
		const trigger = yield* (yield* AutomationTriggerRepository).findById(
			AutomationTriggerId.make("trigger"),
		);
		assert(trigger?.payload);
		yield* (yield* AutomationRunRepository).insertQueued(
			yield* Schema.decodeUnknownEffect(AutomationRun)({
				id,
				stage,
				hookName: id,
				hookSlug: id,
				startedAt: null,
				attemptCount: 0,
				executionUserId,
				finishedAt: null,
				skipReason: null,
				status: "queued",
				nextAttemptAt: null,
				triggerId: "trigger",
				sandboxScriptId: "script",
				scriptContentHash: "hash",
				scriptSlug: "kernel.notify",
				queuedAt: now.toISOString(),
				pluginId: pin?.pluginId ?? null,
				artifactsExpireAt: "2026-09-16T00:00:00.000Z",
				pluginRevisionId: pin?.pluginRevisionId ?? null,
				delivery: stage === "before" ? "policy" : "async",
				pluginConfigRevisionId: pin?.pluginConfigRevisionId ?? null,
				retryPolicy: stage === "before" ? null : DEFAULT_AUTOMATION_RETRY_POLICY,
			}),
			trigger.payload,
		);
		yield* db
			.update(automationRun)
			.set({ startedAt: now, finishedAt: now, attemptCount: 1, status: "failed" })
			.where(eq(automationRun.id, id));
	});

describe("automation retry persistence", () => {
	it.effect("denies foreign retry before eligibility checks or queueing", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seedRun("run");
				const service = yield* AutomationHistoryService;
				const runId = AutomationRunId.make("run");
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

	it.effect("retries an inactive plugin only with its pinned encryption key", () =>
		withDatabase(
			Effect.gen(function* () {
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
						clientConfigSchema: { fields: {} },
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
						clientConfigSchema: { fields: {} },
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
						configuredKeys: [],
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
				yield* seedRun("pinned", owner.id, "after", {
					pluginId: "plugin",
					pluginConfigRevisionId: "config",
					pluginRevisionId: "pinned-revision",
				});
				const service = yield* AutomationHistoryService;
				const runId = AutomationRunId.make("pinned");
				const [storedHistory] = yield* db
					.select({ historyPayload: automationRun.historyPayload })
					.from(automationRun)
					.where(eq(automationRun.id, runId));
				expect(storedHistory?.historyPayload).toMatchObject({ properties: { visible: "kept" } });
				expect(stableStringify(storedHistory?.historyPayload)).not.toContain("hidden");
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
				const [stored] = yield* db.select().from(automationRun).where(eq(automationRun.id, runId));
				expect(stored).toMatchObject({
					sandboxScriptId: "script",
					pluginConfigRevisionId: "config",
					pluginRevisionId: "pinned-revision",
				});
			}),
		),
	);
	it.effect("omits oversized retained payloads and clears history payloads after pruning", () =>
		withDatabase(
			Effect.gen(function* () {
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
				yield* seedRun("large");
				const runId = AutomationRunId.make("large");
				const [retained] = yield* db
					.select({
						historyPayload: automationRun.historyPayload,
						historyPayloadTruncated: automationRun.historyPayloadTruncated,
					})
					.from(automationRun)
					.where(eq(automationRun.id, runId));
				expect(retained).toEqual({ historyPayload: null, historyPayloadTruncated: true });
				yield* db
					.update(automationTrigger)
					.set({ payload: null, payloadPrunedAt: now })
					.where(eq(automationTrigger.id, "trigger"));
				yield* (yield* AutomationRunRepository).clearHistoryPayloads(["trigger"]);
				const [pruned] = yield* db
					.select({
						historyPayload: automationRun.historyPayload,
						historyPayloadTruncated: automationRun.historyPayloadTruncated,
					})
					.from(automationRun)
					.where(eq(automationRun.id, runId));
				expect(pruned).toEqual({ historyPayload: null, historyPayloadTruncated: false });
			}),
		),
	);
});
