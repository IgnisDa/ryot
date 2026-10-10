import { expect, layer } from "@effect/vitest";
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
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";
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
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
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
	accountGeneration: { userId: UserId.make("owner"), token: "test-account-generation" },
};
const other = { ...owner, id: UserId.make("other") };

type RetrySubmission = Parameters<AutomationExecutionOperations["Service"]["submit"]>[0];

type SubmitBehavior = (
	submission: RetrySubmission,
) => Effect.Effect<void, DbError, DatabaseSession>;

class RetrySubmissions extends Context.Service<
	RetrySubmissions,
	Effect.Effect<ReadonlyArray<string>>
>()("test/RetrySubmissions") {}

const recordingExecutionLayer = (submit: SubmitBehavior = () => Effect.void) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const submissions = yield* Ref.make<ReadonlyArray<string>>([]);
			return Context.make(
				AutomationExecutionOperations,
				AutomationExecutionOperations.of({
					settle: () => Effect.die("unused"),
					skipQueuedPolicies: () => Effect.void,
					dispatchStates: () => Effect.die("unused"),
					submit: (submission) =>
						Ref.update(submissions, (all) => [
							...all,
							`${submission.runId}:${submission.attemptNumber}`,
						]).pipe(
							Effect.andThen(submit(submission)),
							Effect.provideService(DatabaseSession, session),
						),
				}),
			).pipe(Context.add(RetrySubmissions, Ref.get(submissions)));
		}),
	);

const seedHistory = Layer.effectDiscard(
	Effect.gen(function* () {
		yield* (yield* DatabaseSession).run((db) =>
			Effect.gen(function* () {
				yield* db.insert(user).values([
					{ id: owner.id, name: owner.name, email: owner.email },
					{ id: other.id, name: "Other", email: "other@example.com" },
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
						lane: "interactive",
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
							...emptySandboxExecutionMetadata,
							kind: "automation",
							slug: "kernel.notify",
						},
					});
			}),
		);
	}),
);

const historyDatabaseLayer = (submit?: SubmitBehavior) =>
	AutomationHistoryService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				AutomationHistoryRepository.layer,
				AutomationAttemptRepository.layer,
				AutomationRunRepository.layer,
				AutomationTriggerRepository.layer,
				recordingExecutionLayer(submit),
			),
		),
		Layer.provideMerge(seedHistory),
		Layer.provideMerge(isolatedDatabaseLayer("history_test")),
	);

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
		yield* (yield* DatabaseSession).run((db) =>
			db
				.update(automationRun)
				.set({ startedAt: now, finishedAt: now, attemptCount: 1, status: "failed" })
				.where(eq(automationRun.id, id)),
		);
	});

describe("automation retry persistence", () => {
	layer(historyDatabaseLayer(() => Effect.die("Unauthorized retry dispatched")))((test) => {
		test.effect("denies foreign retry before eligibility checks or queueing", () =>
			Effect.gen(function* () {
				yield* seedRun("run");
				const service = yield* AutomationHistoryService;
				const runId = AutomationRunId.make("run");
				assertExitFails(
					yield* service.retryRun(other, runId, { expectedAttemptCount: 1 }).pipe(Effect.exit),
					new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } }),
				);
				const [stored] = yield* (yield* DatabaseSession).run((db) =>
					db.select().from(automationRun).where(eq(automationRun.id, runId)),
				);
				expect(stored?.status).toBe("failed");
			}),
		);
	});

	layer(
		historyDatabaseLayer(() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const [row] = yield* session.run((db) =>
					db
						.select({ status: automationRun.status })
						.from(automationRun)
						.where(eq(automationRun.id, "run")),
				);
				expect(row?.status).toBe("queued");
				return yield* new DbError({ message: "private-dispatch-error" });
			}),
		),
	)((test) => {
		test.effect(
			"queues the same owned run before submission and preserves pending work if dispatch fails",
			() =>
				Effect.gen(function* () {
					yield* seedRun("run");
					const service = yield* AutomationHistoryService;
					const result = yield* service.retryRun(owner, AutomationRunId.make("run"), {
						expectedAttemptCount: 1,
					});
					expect(result).toEqual({ runId: "run", attemptNumber: 2, dispatch: "pending" });
					expect(yield* yield* RetrySubmissions).toEqual(["run:2"]);
					const [stored] = yield* (yield* DatabaseSession).run((db) =>
						db.select().from(automationRun).where(eq(automationRun.id, "run")),
					);
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
		);
	});

	layer(historyDatabaseLayer())((test) => {
		test.effect("rejects expired, before-policy and stale retries", () =>
			Effect.gen(function* () {
				yield* seedRun("expired");
				yield* seedRun("policy", owner.id, "before");
				yield* seedRun("stale");
				yield* (yield* DatabaseSession).run((db) =>
					db
						.update(automationRun)
						.set({ artifactsExpireAt: now })
						.where(eq(automationRun.id, "expired")),
				);
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
		);
	});

	layer(historyDatabaseLayer())((test) => {
		test.effect("retries an inactive plugin only with its pinned encryption key", () =>
			Effect.gen(function* () {
				yield* (yield* DatabaseSession).run((db) =>
					Effect.gen(function* () {
						const base = fixtureManifest();
						yield* db.insert(plugin).values({ id: "plugin", slug: "fixture", status: "inactive" });
						yield* db.insert(pluginRevision).values([
							{
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
								encryptionKeyId: "key",
								nonce: Buffer.alloc(12),
								payloadFingerprint: "fingerprint",
								encryptedPayload: Buffer.alloc(16),
								pluginRevisionId: "pinned-revision",
							});
						yield* db
							.update(sandboxScript)
							.set({ source: null, pluginRevisionId: "pinned-revision" })
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
						expect(storedHistory?.historyPayload).toMatchObject({
							properties: { visible: "kept" },
						});
						expect(stableStringify(storedHistory?.historyPayload)).not.toContain("hidden");
						assertExitFails(
							yield* service.retryRun(owner, runId, { expectedAttemptCount: 1 }).pipe(Effect.exit),
							new AutomationHistoryRetryConflict({ reason: { runId, code: "missing-artifact" } }),
						);
						yield* db
							.insert(pluginConfigEncryptionKey)
							.values({ id: "key", key: Buffer.alloc(32) });
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
				);
			}),
		);
	});
	layer(historyDatabaseLayer())((test) => {
		test.effect("omits oversized retained payloads and clears history payloads after pruning", () =>
			Effect.gen(function* () {
				yield* (yield* DatabaseSession).run((db) =>
					Effect.gen(function* () {
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
				);
			}),
		);
	});
});
