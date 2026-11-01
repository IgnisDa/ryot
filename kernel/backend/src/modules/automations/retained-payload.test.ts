import { expect, layer } from "@effect/vitest";
import {
	AutomationRun,
	AutomationTriggerPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationRunId,
	AutomationTriggerId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { assert, describe } from "vitest";

import { fixtureManifest, insertPluginRevision } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import { automationRun, automationTrigger } from "#schema/tables/automations";
import { plugin, pluginConfigRevision, sandboxScript } from "#schema/tables/core";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AUTOMATION_HISTORY_LIMITS } from "./history-limits";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const now = new Date(0);

const seedHistory = Layer.effectDiscard(
	Effect.gen(function* () {
		yield* (yield* DatabaseSession).run((db) =>
			Effect.gen(function* () {
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

const historyDatabaseLayer = Layer.mergeAll(
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
).pipe(
	Layer.provideMerge(seedHistory),
	Layer.provideMerge(isolatedDatabaseLayer("retained_payload_test")),
);

const pinnedRevision = {
	pluginId: "plugin",
	pluginConfigRevisionId: "config",
	pluginRevisionId: "pinned-revision",
};

const seedRun = (
	id: string,
	pin: null | {
		readonly pluginId: string;
		readonly pluginRevisionId: string;
		readonly pluginConfigRevisionId: string;
	} = null,
) =>
	Effect.gen(function* () {
		const trigger = yield* (yield* AutomationTriggerRepository).findById(
			AutomationTriggerId.make("trigger"),
		);
		assert(trigger?.payload);
		yield* (yield* AutomationRunRepository).insertQueued({
			triggerPayload: trigger.payload,
			runs: [
				yield* Schema.decodeUnknownEffect(AutomationRun)({
					id,
					hookName: id,
					hookSlug: id,
					stage: "after",
					startedAt: null,
					attemptCount: 0,
					finishedAt: null,
					skipReason: null,
					status: "queued",
					delivery: "async",
					nextAttemptAt: null,
					triggerId: "trigger",
					executionUserId: null,
					sandboxScriptId: "script",
					scriptContentHash: "hash",
					scriptSlug: "kernel.notify",
					queuedAt: now.toISOString(),
					pluginId: pin?.pluginId ?? null,
					retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
					artifactsExpireAt: "2026-09-16T00:00:00.000Z",
					pluginRevisionId: pin?.pluginRevisionId ?? null,
					pluginConfigRevisionId: pin?.pluginConfigRevisionId ?? null,
				}),
			],
		});
	});

const seedPinnedRevisions = (pinnedManifest: (base: PluginManifest) => PluginManifest) =>
	Effect.gen(function* () {
		const base = fixtureManifest();
		const pinned = pinnedManifest(base);
		yield* (yield* DatabaseSession).run((db) =>
			Effect.gen(function* () {
				yield* db
					.insert(plugin)
					.values({ id: "plugin", status: "inactive", packageId: base.metadata.packageId });
				yield* insertPluginRevision(db, {
					manifest: pinned,
					contentHash: "old",
					pluginId: "plugin",
					id: "pinned-revision",
				});
				yield* insertPluginRevision(db, {
					manifest: base,
					pluginId: "plugin",
					contentHash: "current",
					id: "current-revision",
				});
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
			}),
		);
	});

describe("retained automation payloads", () => {
	layer(historyDatabaseLayer)((test) => {
		test.effect("redacts secret entity properties with the pinned revision schema", () =>
			Effect.gen(function* () {
				yield* (yield* DatabaseSession).run((db) =>
					Effect.gen(function* () {
						yield* seedPinnedRevisions((base) => ({
							...base,
							entitySchemas: base.entitySchemas.map((entity) =>
								Object.assign({}, entity, {
									propertiesSchema: {
										fields: {
											count: { type: "number", label: "Count", description: "Counter" },
											token: {
												secret: true,
												type: "string",
												label: "Token",
												description: "Secret token",
											},
										},
									} satisfies AppSchema,
								}),
							),
						}));
						const snapshot = {
							id: "entity",
							name: "Item",
							externalId: null,
							providerId: null,
							populatedAt: null,
							entitySchemaPluginId: "plugin",
							entitySchemaSlug: "fixture-entity",
							createdAt: "2026-09-15T00:00:00.000Z",
							updatedAt: "2026-09-15T00:00:00.000Z",
							properties: { count: 2, token: "hidden" },
						};
						yield* db
							.update(automationTrigger)
							.set({
								category: "change",
								operation: "update",
								resourceKind: "entity",
								payload: yield* Schema.decodeEffect(AutomationTriggerPayload)({
									after: snapshot,
									before: snapshot,
									category: "change",
									resource: "entity",
									operation: "update",
								}),
							})
							.where(eq(automationTrigger.id, "trigger"));
						yield* seedRun("pinned", pinnedRevision);
						const [stored] = yield* db
							.select({ historyPayload: automationRun.historyPayload })
							.from(automationRun)
							.where(eq(automationRun.id, "pinned"));
						expect(stored?.historyPayload).toMatchObject({
							after: { properties: { count: 2 } },
							before: { properties: { count: 2 } },
						});
						expect(stableStringify(stored?.historyPayload)).not.toContain("hidden");
					}),
				);
			}),
		);
	});
	layer(historyDatabaseLayer)((test) => {
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
