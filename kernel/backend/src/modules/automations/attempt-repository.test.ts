import { it } from "@effect/vitest";
import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId, SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { assert, describe, expect, it as unit } from "vitest";

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
import { Database, DatabaseLive } from "#lib/infrastructure/db/service";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { fixtureManifest } from "#modules/plugins/test-support";

import {
	AUTOMATION_ATTEMPT_ARTIFACT_BYTES,
	AutomationAttemptRepository,
	automationAttemptIdentity,
	boundAutomationAttemptArtifacts,
	type FinalizeAutomationAttempt,
	projectAutomationAttemptHistory,
} from "./attempt-repository";

const now = new Date("2026-09-15T00:00:00.000Z");
const runId = AutomationRunId.make("attempt-test");
const failure: FinalizeAutomationAttempt = {
	runId,
	logs: [],
	attemptNumber: 1,
	status: "failed",
	returnedValue: null,
	failureKind: "sandbox-timeout",
	timing: { totalMs: 10, executionMs: 8 },
	error: { code: "timeout", message: "Timed out" },
};

const withDatabase = <E>(test: Effect.Effect<void, E, Database | AutomationAttemptRepository>) => {
	const schema = `attempt_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const url = testDatabaseUrl();
	const layer = DatabaseLive.pipe(
		Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
	);
	return Effect.gen(function* () {
		const db = yield* Database;
		const directory = new URL("../../drizzle/", import.meta.url).pathname;
		const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
		assert(paths.length === 1);
		const ddl = yield* Effect.promise(() => Bun.file(directory + paths[0]).text());
		yield* db.execute(sql`create database ${sql.identifier(schema)}`);
		yield* Effect.gen(function* () {
			const scopedUrl = new URL(url);
			scopedUrl.pathname = `/${schema}`;
			const scopedLayer = DatabaseLive.pipe(
				Layer.provide(
					makeAppConfigLayer({ database: { url: Redacted.make(scopedUrl.toString()) } }),
				),
				Layer.fresh,
			);
			yield* Effect.gen(function* () {
				const isolated = yield* Database;
				for (const statement of ddl.split("--> statement-breakpoint")) {
					yield* isolated.execute(sql.raw(statement));
				}
				yield* test;
			}).pipe(Effect.provide(Layer.merge(AutomationAttemptRepository.layer, scopedLayer)));
		}).pipe(
			Effect.ensuring(db.execute(sql`drop database ${sql.identifier(schema)}`).pipe(Effect.orDie)),
		);
	}).pipe(Effect.provide(layer.pipe(Layer.provideMerge(makeConfigProviderLayer()))));
};

const seed = (stage: "after" | "before" = "after", maxAttempts = 2) =>
	Effect.gen(function* () {
		const db = yield* Database;
		yield* db
			.insert(automationTrigger)
			.values({
				depth: 0,
				id: "trigger",
				source: "api",
				occurredAt: now,
				operation: "emit",
				category: "signal",
				executionId: "command",
				resourceKind: "signal",
				initiatorKind: "system",
				rootExecutionId: "command",
				payload: {
					properties: {},
					operation: "emit",
					actorUserId: null,
					category: "signal",
					resource: "signal",
					signalSchemaPluginId: null,
					signalSchemaSlug: SignalSchemaSlug.make("test.signal"),
				},
			});
		yield* db
			.insert(sandboxScript)
			.values({
				id: "script",
				name: "Notify",
				source: "source",
				contentHash: "hash",
				compiledCode: "code",
				slug: "kernel.notify",
				metadata: {
					name: "Notify",
					capabilities: [],
					kind: "automation",
					slug: "kernel.notify",
					requiredPluginConfigKeys: [],
					requiredSystemConfigKeys: [],
				},
			});
		yield* db
			.insert(automationRun)
			.values({
				stage,
				id: runId,
				queuedAt: now,
				hookName: "Notify",
				triggerId: "trigger",
				hookSlug: "kernel.notify",
				scriptContentHash: "hash",
				sandboxScriptId: "script",
				scriptSlug: "kernel.notify",
				delivery: stage === "before" ? "policy" : "async",
				artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe("2026-10-15T00:00:00.000Z")),
				retryPolicy:
					stage === "before" ? null : { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts },
			});
	});

unit("bounds each UTF-8/escaped artifact while preserving small values", () => {
	const huge = '😀\\"'.repeat(AUTOMATION_ATTEMPT_ARTIFACT_BYTES);
	const artifacts = boundAutomationAttemptArtifacts({
		returnedValue: { huge },
		logs: [{ level: "info", message: huge }],
		error: { message: huge, code: "failure" },
	});
	for (const artifact of Object.values(artifacts)) {
		expect(Buffer.byteLength(stableStringify(artifact))).toBeLessThanOrEqual(
			AUTOMATION_ATTEMPT_ARTIFACT_BYTES,
		);
	}
	expect(artifacts.logs?.[0]?.level).toBe("warning");
	expect(
		boundAutomationAttemptArtifacts({ logs: null, error: null, returnedValue: `${huge}a` })
			.returnedValue,
	).not.toEqual(
		boundAutomationAttemptArtifacts({ logs: null, error: null, returnedValue: `${huge}b` })
			.returnedValue,
	);
	expect(boundAutomationAttemptArtifacts({ logs: [], error: null, returnedValue: false })).toEqual({
		logs: [],
		error: null,
		returnedValue: false,
	});
	expect(automationAttemptIdentity(runId, 1)).not.toEqual(automationAttemptIdentity(runId, 2));
});

const diagnostics = {
	failureKind: "business-failure",
	error: { code: "private-error-code", message: "Authorization: Bearer private-token" },
	logs: [
		{
			level: "error",
			message: "password=private-password",
			attributes: { nested: { count: 2, apiKey: "private-key" } },
		},
	],
} satisfies Parameters<typeof projectAutomationAttemptHistory>[0];

unit("projects attempt history with sensitive diagnostic redaction", () => {
	const projected = projectAutomationAttemptHistory(diagnostics);
	expect(projected.historyError).toEqual({
		code: "business-failure",
		message: "Authorization: [REDACTED]",
	});
	expect(projected.historyLogs).toEqual([
		{
			level: "error",
			message: "password=[REDACTED]",
			attributes: { nested: { count: 2, apiKey: "[REDACTED]" } },
		},
	]);
	expect(JSON.stringify(projected)).not.toContain("private-");
});

unit("bounds UTF-8 attempt history and marks truncation", () => {
	const huge = "😀".repeat(AUTOMATION_HISTORY_LIMITS.attemptBytes);
	const projected = projectAutomationAttemptHistory({
		...diagnostics,
		error: { message: huge, code: "failure" },
		logs: [
			{ level: "info", message: huge },
			{ level: "info", message: "small" },
		],
	});
	expect(projected.historyArtifactsTruncated).toBe(true);
	expect(projected.historyLogs).toEqual([{ level: "info", message: "small" }]);
	expect(
		Buffer.byteLength(
			JSON.stringify({ logs: projected.historyLogs, error: projected.historyError }),
		),
	).toBeLessThan(AUTOMATION_HISTORY_LIMITS.attemptBytes);
	const many = projectAutomationAttemptHistory({
		...diagnostics,
		logs: Array.from({ length: 100 }, () => ({ level: "info", message: "token=x ".repeat(30) })),
	});
	expect(many.historyArtifactsTruncated).toBe(true);
	expect(many.historyLogs?.length).toBeGreaterThan(0);
	expect(
		Buffer.byteLength(JSON.stringify({ logs: many.historyLogs, error: many.historyError })),
	).toBeLessThanOrEqual(AUTOMATION_HISTORY_LIMITS.attemptBytes);
});

describe("AutomationAttemptRepository (PostgreSQL)", () => {
	it.effect(
		"serializes claims/finalization, replays one attempt, caps automatic retries and atomically queues one manual retry",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seed();
					const repo = yield* AutomationAttemptRepository;
					const db = yield* Database;
					const claims = yield* Effect.all(
						[
							repo.claimNextAttempt({ now, runId, attemptNumber: 1 }),
							repo.claimNextAttempt({ now, runId, attemptNumber: 1 }),
						],
						{ concurrency: 2 },
					);
					expect(claims.map((c) => c.claimed).sort((a, b) => Number(a) - Number(b))).toEqual([
						false,
						true,
					]);
					assert(claims[0].attempt);
					assert(claims[1].attempt);
					expect(claims[0].attempt.id).toBe(claims[1].attempt.id);
					expect(
						yield* repo.claimNextAttempt({ now, runId, attemptNumber: 2 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					const outcomes = yield* Effect.all(
						[
							repo.finalizeAttempt(failure, now),
							repo.finalizeAttempt(
								failure,
								DateTime.toDate(DateTime.makeUnsafe(now.getTime() + 1)),
							),
						],
						{ concurrency: 2 },
					);
					expect(outcomes[0]).toEqual(outcomes[1]);
					expect(
						yield* repo
							.finalizeAttempt(
								{ ...failure, error: { code: "different", message: "conflict" } },
								now,
							)
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					expect(yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 })).toMatchObject({
						claimed: false,
						attempt: { status: "failed" },
					});
					expect(
						yield* repo.claimNextAttempt({ now, runId, attemptNumber: 2 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					const due = DateTime.toDate(DateTime.makeUnsafe(now.getTime() + 1001));
					yield* repo.claimNextAttempt({ runId, now: due, attemptNumber: 2 });
					yield* repo.finalizeAttempt({ ...failure, attemptNumber: 2 }, due);
					const [failed] = yield* db.select().from(automationRun);
					expect(failed).toMatchObject({
						startedAt: now,
						attemptCount: 2,
						finishedAt: due,
						status: "failed",
						nextAttemptAt: null,
					});
					expect(yield* repo.retryEligibility(runId, due)).toBeNull();
					const retries = yield* Effect.all(
						[
							repo.queueRetry({ runId, now: due, expectedAttemptCount: 2 }).pipe(Effect.exit),
							repo.queueRetry({ runId, now: due, expectedAttemptCount: 2 }).pipe(Effect.exit),
						],
						{ concurrency: 2 },
					);
					expect(retries.map((r) => r._tag).sort()).toEqual(["Failure", "Success"]);
					yield* repo.claimNextAttempt({ runId, now: due, attemptNumber: 3 });
					yield* repo.finalizeAttempt(
						{
							...failure,
							error: null,
							attemptNumber: 3,
							failureKind: null,
							status: "succeeded",
							returnedValue: { ok: true },
						},
						due,
					);
					expect(
						yield* repo.queueRetry({ runId, now: due, expectedAttemptCount: 2 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					const rows = yield* db.select().from(automationRunAttempt);
					expect(rows).toHaveLength(3);
					expect(rows.every((row) => row.status !== "running")).toBe(true);
					const [succeeded] = yield* db.select().from(automationRun);
					expect(succeeded).toMatchObject({
						attemptCount: 3,
						finishedAt: due,
						status: "succeeded",
						nextAttemptAt: null,
					});
				}),
			),
	);

	it.effect(
		"terminalizes a queued run when its execution user is disabled between planning and claim",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seed();
					const repo = yield* AutomationAttemptRepository;
					const db = yield* Database;
					yield* db
						.insert(user)
						.values({ id: "owner", name: "Owner", preferences: {}, email: "owner@example.test" });
					yield* db
						.update(automationRun)
						.set({ executionUserId: "owner" })
						.where(eq(automationRun.id, runId));
					yield* db.update(user).set({ disabledAt: now }).where(eq(user.id, "owner"));
					expect(yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 })).toEqual({
						attempt: null,
						claimed: false,
					});
					const [run] = yield* db.select().from(automationRun);
					expect(run).toMatchObject({
						attemptCount: 0,
						finishedAt: now,
						status: "skipped",
						nextAttemptAt: null,
						skipReason: { code: "user-disabled" },
					});
					expect(yield* db.select().from(automationRunAttempt)).toEqual([]);
					expect(yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 })).toEqual({
						attempt: null,
						claimed: false,
					});
				}),
			),
	);

	it.effect("terminalizes a due retry at artifact expiry without creating another attempt", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seed();
				const repo = yield* AutomationAttemptRepository;
				const db = yield* Database;
				yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
				yield* repo.finalizeAttempt(failure, now);
				const expiresAt = DateTime.toDate(DateTime.makeUnsafe(now.getTime() + 1001));
				yield* db
					.update(automationRun)
					.set({ artifactsExpireAt: expiresAt })
					.where(eq(automationRun.id, runId));
				expect(yield* repo.claimNextAttempt({ runId, now: expiresAt, attemptNumber: 2 })).toEqual({
					attempt: null,
					claimed: false,
				});
				const [run] = yield* db.select().from(automationRun);
				expect(run).toMatchObject({
					attemptCount: 1,
					status: "failed",
					nextAttemptAt: null,
					finishedAt: expiresAt,
				});
				expect(yield* db.select().from(automationRunAttempt)).toHaveLength(1);
			}),
		),
	);

	it.effect(
		"blocks manual retries after expiry or artifact loss and never re-resolves a kernel script",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seed("after", 1);
					const repo = yield* AutomationAttemptRepository;
					const db = yield* Database;
					yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
					yield* repo.finalizeAttempt(failure, now);
					expect(
						yield* repo.retryEligibility(
							runId,
							DateTime.toDate(DateTime.makeUnsafe("2026-10-15T00:00:00.000Z")),
						),
					).toBe("expired");
					expect(
						yield* repo
							.queueRetry({
								runId,
								expectedAttemptCount: 1,
								now: DateTime.toDate(DateTime.makeUnsafe("2026-10-15T00:00:00.000Z")),
							})
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					yield* db.update(automationTrigger).set({ payload: null, payloadPrunedAt: now });
					expect(yield* repo.retryEligibility(runId, now)).toBe("missing-artifact");
					yield* db
						.update(automationRun)
						.set({ sandboxScriptId: null })
						.where(eq(automationRun.id, runId));
					expect(yield* repo.retryEligibility(runId, now)).toBe("missing-artifact");
					expect(
						yield* repo.queueRetry({ now, runId, expectedAttemptCount: 1 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
				}),
			),
	);

	it.effect(
		"requires the retained config payload and exact encryption key even for an inactive plugin",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seed("after", 1);
					const repo = yield* AutomationAttemptRepository;
					const db = yield* Database;
					yield* db
						.insert(plugin)
						.values({ id: "plugin", slug: "fixture", scope: "system", status: "inactive" });
					yield* db
						.insert(pluginRevision)
						.values({
							version: "1",
							id: "revision",
							pluginId: "plugin",
							sourceHash: "source",
							manifest: fixtureManifest(),
							clientConfigSchema: { fields: {} },
						});
					yield* db
						.insert(pluginConfigRevision)
						.values({
							id: "config",
							configuredKeys: [],
							scope: "environment",
							encryptionKeyId: "key",
							nonce: Buffer.alloc(12),
							pluginRevisionId: "revision",
							payloadFingerprint: "fingerprint",
							encryptedPayload: Buffer.alloc(16),
						});
					yield* db
						.update(sandboxScript)
						.set({ pluginRevisionId: "revision" })
						.where(eq(sandboxScript.id, "script"));
					yield* db
						.update(automationRun)
						.set({
							pluginId: "plugin",
							pluginRevisionId: "revision",
							pluginConfigRevisionId: "config",
						})
						.where(eq(automationRun.id, runId));
					yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
					yield* repo.finalizeAttempt(failure, now);
					expect(yield* repo.retryEligibility(runId, now)).toBe("missing-artifact");
					expect(
						yield* repo.queueRetry({ now, runId, expectedAttemptCount: 1 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					yield* db.insert(pluginConfigEncryptionKey).values({ id: "key", key: Buffer.alloc(32) });
					expect(yield* repo.retryEligibility(runId, now)).toBeNull();
					yield* db
						.update(pluginConfigRevision)
						.set({ payloadPrunedAt: now, encryptedPayload: null });
					expect(yield* repo.retryEligibility(runId, now)).toBe("missing-artifact");
					expect(
						yield* repo.queueRetry({ now, runId, expectedAttemptCount: 1 }).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					yield* db
						.update(pluginConfigRevision)
						.set({ payloadPrunedAt: null, encryptedPayload: Buffer.alloc(16) });
					expect(yield* repo.queueRetry({ now, runId, expectedAttemptCount: 1 })).toMatchObject({
						attemptNumber: 2,
					});
				}),
			),
	);

	it.effect(
		"writes redacted attempt history when finalizing and clears it with pruned artifacts",
		() =>
			withDatabase(
				Effect.gen(function* () {
					yield* seed("after", 1);
					const repo = yield* AutomationAttemptRepository;
					const db = yield* Database;
					yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
					expect(yield* repo.retryEligibility(runId, now)).toBe("not-failed");
					yield* repo.finalizeAttempt(
						{
							...failure,
							logs: [{ level: "info", message: "password=private-password" }],
							error: { code: "timeout", message: "Authorization: Bearer private-token" },
						},
						now,
					);
					const [finalized] = yield* db.select().from(automationRunAttempt);
					expect(finalized).toMatchObject({
						historyArtifactsTruncated: false,
						historyLogs: [{ level: "info", message: "password=[REDACTED]" }],
						historyError: { code: "sandbox-timeout", message: "Authorization: [REDACTED]" },
					});
					const expiry = DateTime.toDate(DateTime.makeUnsafe("2026-10-15T00:00:00.000Z"));
					expect(
						yield* repo.pruneArtifacts({ limit: 10, before: expiry, prunedAt: expiry }),
					).toHaveLength(1);
					const [pruned] = yield* db.select().from(automationRunAttempt);
					expect(pruned).toMatchObject({
						logs: null,
						error: null,
						historyLogs: null,
						historyError: null,
						artifactsPrunedAt: expiry,
						historyArtifactsTruncated: false,
					});
				}),
			),
	);

	it.effect("records a policy rejection as a successful attempt and a rejected logical run", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seed("before");
				const repo = yield* AutomationAttemptRepository;
				const db = yield* Database;
				yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
				yield* repo.finalizeAttempt(
					{
						...failure,
						error: null,
						failureKind: null,
						status: "succeeded",
						returnedValue: { action: "reject", reason: "denied" },
					},
					now,
				);
				const [run] = yield* db.select().from(automationRun);
				expect(run).toMatchObject({
					attemptCount: 1,
					finishedAt: now,
					status: "rejected",
					nextAttemptAt: null,
				});
				expect(yield* repo.findAttempt(runId, 1)).toMatchObject({
					failureKind: null,
					status: "succeeded",
				});
			}),
		),
	);

	it.effect("keeps before policy infrastructure failures terminal with one attempt", () =>
		withDatabase(
			Effect.gen(function* () {
				yield* seed("before");
				const repo = yield* AutomationAttemptRepository;
				const db = yield* Database;
				yield* repo.claimNextAttempt({ now, runId, attemptNumber: 1 });
				expect(yield* repo.finalizeAttempt(failure, now)).toMatchObject({ retryable: false });
				expect(yield* repo.retryEligibility(runId, now)).toBe("before-policy");
				expect(
					yield* repo.queueRetry({ now, runId, expectedAttemptCount: 1 }).pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(
					yield* repo.claimNextAttempt({ now, runId, attemptNumber: 2 }).pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				const [run] = yield* db.select().from(automationRun);
				expect(run).toMatchObject({
					attemptCount: 1,
					finishedAt: now,
					status: "failed",
					nextAttemptAt: null,
				});
			}),
		),
	);
});
