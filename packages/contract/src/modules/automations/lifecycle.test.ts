import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { PluginId } from "../../schema/brands";
import {
	AutomationAfterInputProjection,
	AutomationCausation,
	AutomationInput,
	AutomationPolicyInput,
	AutomationPolicyInputProjection,
	AutomationPolicyOutput,
	AutomationRetryPolicy,
	AutomationRun,
	AutomationRunAttempt,
	AutomationTrigger,
	AutomationTriggerPayload,
	AutomationWarning,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "./lifecycle";

const timestamp = "2026-09-15T00:00:00.000Z";
const causation = {
	depth: 0,
	source: "api",
	parentRunId: null,
	lane: "interactive",
	parentTriggerId: null,
	executionId: "command-1",
	rootExecutionId: "command-1",
	initiator: { kind: "user", id: "user-1" },
};
const drafts = [
	{
		resource: "entity",
		draft: {
			name: "Item",
			providerId: null,
			externalId: null,
			populatedAt: null,
			entitySchemaSlug: "item",
			properties: { count: 1 },
			entitySchemaPluginId: null,
		},
	},
	{
		resource: "event",
		draft: {
			entityId: "entity-1",
			occurredAt: timestamp,
			sessionEntityId: null,
			entitySchemaSlug: "item",
			eventSchemaPluginId: null,
			entitySchemaPluginId: null,
			eventSchemaSlug: "progress",
			properties: { progress: 25 },
		},
	},
	{
		resource: "relationship",
		draft: {
			properties: {},
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			relationshipSchemaPluginId: null,
			relationshipSchemaSlug: "contains",
		},
	},
];

describe("lifecycle payload boundaries", () => {
	it.effect("records pinned run attribution without permitting delayed policy attempts", () =>
		Effect.gen(function* () {
			const run = {
				id: "run-1",
				stage: "before",
				attemptCount: 1,
				status: "failed",
				skipReason: null,
				retryPolicy: null,
				hookName: "Policy",
				delivery: "policy",
				nextAttemptAt: null,
				queuedAt: timestamp,
				pluginId: "plugin-1",
				scriptSlug: "policy",
				startedAt: timestamp,
				finishedAt: timestamp,
				triggerId: "trigger-1",
				hookSlug: "item.policy",
				executionUserId: "user-1",
				sandboxScriptId: "script-1",
				scriptContentHash: "hash-1",
				artifactsExpireAt: timestamp,
				pluginRevisionId: "revision-1",
				pluginConfigRevisionId: "config-1",
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationRun)(run)).toEqual(run);
			const kernelOwnership = {
				pluginId: null,
				pluginRevisionId: null,
				pluginConfigRevisionId: null,
			};
			for (const stage of [
				{},
				{ stage: "after", delivery: "async", retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY },
				{ stage: "after", delivery: "required", retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY },
			]) {
				for (const sandboxScriptId of ["script-1", null]) {
					const kernelRun = { ...run, ...stage, ...kernelOwnership, sandboxScriptId };
					expect(yield* Schema.decodeUnknownEffect(AutomationRun)(kernelRun)).toEqual(kernelRun);
					if (sandboxScriptId === null) {
						for (const status of ["queued", "running"]) {
							yield* Effect.flip(
								Schema.decodeUnknownEffect(AutomationRun)({ ...kernelRun, status }),
							);
						}
					}
				}
				for (const pluginId of [null, "plugin-1"]) {
					for (const pluginRevisionId of [null, "revision-1"]) {
						for (const pluginConfigRevisionId of [null, "config-1"]) {
							if (
								(pluginId === null) === (pluginRevisionId === null) &&
								(pluginId === null) === (pluginConfigRevisionId === null)
							) {
								continue;
							}
							yield* Effect.flip(
								Schema.decodeUnknownEffect(AutomationRun)({
									...run,
									...stage,
									pluginId,
									pluginRevisionId,
									pluginConfigRevisionId,
								}),
							);
						}
					}
				}
			}
			for (const change of [
				{ status: "queued", sandboxScriptId: null },
				{ status: "running", sandboxScriptId: null },
				{ retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY },
				{ nextAttemptAt: timestamp },
				{ attemptCount: 2 },
				{ delivery: "required" },
				{ pluginRevisionId: null },
				{ pluginConfigRevisionId: null },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(AutomationRun)({ ...run, ...change }));
			}
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationRun)({
					...run,
					stage: "after",
					delivery: "async",
					sandboxScriptId: null,
					nextAttemptAt: timestamp,
					retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
				}),
			);
			expect(
				yield* Schema.decodeUnknownEffect(AutomationRun)({
					...run,
					stage: "after",
					delivery: "async",
					sandboxScriptId: null,
					retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
				}),
			).toMatchObject({
				sandboxScriptId: null,
				pluginRevisionId: "revision-1",
				pluginConfigRevisionId: "config-1",
			});
		}),
	);

	it.effect("retains numbered attempt outcomes when large artifacts are pruned", () =>
		Effect.gen(function* () {
			const attempt = {
				logs: null,
				error: null,
				runId: "run-1",
				id: "attempt-1",
				attemptNumber: 1,
				status: "failed",
				retryable: false,
				returnedValue: null,
				startedAt: timestamp,
				finishedAt: timestamp,
				artifactsPrunedAt: timestamp,
				workflowExecutionId: "attempt-workflow-1",
				failureKind: "external-uncertain-outcome",
				timing: { totalMs: 10.25, executionMs: 8.125 },
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationRunAttempt)(attempt)).toEqual(attempt);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationRunAttempt)({ ...attempt, attemptNumber: 0 }),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationRunAttempt)({
					...attempt,
					timing: { ...attempt.timing, executionMs: -1 },
				}),
			);
		}),
	);

	it.effect.each(drafts.filter(({ resource }) => resource !== "event"))(
		"retains provider monitoring context on $resource changes with exact snapshots",
		({ draft, resource }) =>
			Effect.gen(function* () {
				const snapshot = { ...draft, id: "entity-1", createdAt: timestamp, updatedAt: timestamp };
				const population = {
					rootPreviouslyPopulated: true,
					scopeEntity: {
						id: "show-1",
						name: "Show",
						entitySchemaSlug: "show",
						entitySchemaPluginId: null,
					},
					parentEntity: {
						name: "Part",
						properties: { part: 2 },
						entitySchemaSlug: "part",
						entitySchemaPluginId: null,
					},
					batch: {
						id: "batch-1",
						afterCount: 3,
						isLeader: true,
						beforeCount: 2,
						createdCount: 1,
						deletedCount: 0,
						updatedCount: 2,
					},
				};
				for (const change of [
					{ after: snapshot, operation: "create" },
					{
						before: snapshot,
						operation: "update",
						after: { ...snapshot, properties: { updated: true } },
					},
					{ before: snapshot, operation: "delete" },
				]) {
					const payload = { resource, category: "change", ...change, population };
					expect(yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload)).toEqual(
						payload,
					);
					for (const invalid of [
						{ ...payload, population: { ...population, rootPreviouslyPopulated: undefined } },
						{
							...payload,
							population: { ...population, batch: { ...population.batch, createdCount: -1 } },
						},
						{ ...payload, after: undefined, before: undefined },
					]) {
						yield* Effect.flip(Schema.decodeUnknownEffect(AutomationTriggerPayload)(invalid));
					}
				}
				yield* Effect.flip(
					Schema.decodeUnknownEffect(AutomationTriggerPayload)({
						draft,
						resource,
						population,
						category: "request",
						operation: "create",
					}),
				);
			}),
	);

	it.effect("requires the trusted execution principal in policy and after invocations", () =>
		Effect.gen(function* () {
			for (const [schema, payload] of [
				[
					AutomationInput,
					{
						category: "change",
						resource: "entity",
						operation: "delete",
						before: {
							...drafts[0]?.draft,
							id: "entity-1",
							createdAt: timestamp,
							updatedAt: timestamp,
						},
					},
				],
				[
					AutomationPolicyInput,
					{ resource: "entity", category: "request", operation: "create", draft: drafts[0]?.draft },
				],
			] as const) {
				for (const executionUserId of [null, "user-1"]) {
					const input = {
						automation: {
							payload,
							causation,
							runId: "run-1",
							executionUserId,
							hookSlug: "item.hook",
							occurredAt: timestamp,
							triggerId: "trigger-1",
						},
					};
					expect(yield* Schema.decodeUnknownEffect(schema)(input)).toEqual(input);
					yield* Effect.flip(
						Schema.decodeUnknownEffect(schema)({
							automation: { ...input.automation, executionUserId: undefined },
						}),
					);
				}
			}
		}),
	);

	it.effect("validates explicit input projections", () =>
		Effect.gen(function* () {
			const projection = {
				providerEntityImport: true,
				signal: { properties: ["message"] },
				entity: {
					properties: ["title", "status"],
					parentEntityProperties: ["part"],
					compareProperties: [
						{ equality: "json", property: "status" },
						{ property: "tags", equality: "unordered-array" },
					],
				},
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationAfterInputProjection)(projection)).toEqual(
				projection,
			);
			yield* Effect.flip(Schema.decodeEffect(AutomationPolicyInputProjection)(projection));
			expect(
				yield* Schema.decodeEffect(AutomationAfterInputProjection)({
					event: {
						properties: [" title "],
						compareProperties: [{ equality: "json", property: " status " }],
					},
				}),
			).toEqual({
				event: {
					properties: ["title"],
					compareProperties: [{ equality: "json", property: "status" }],
				},
			});
			expect(
				yield* Schema.decodeEffect(AutomationPolicyInputProjection)({
					event: { properties: [] },
					entity: { properties: ["title"] },
					relationship: { properties: ["role"] },
				}),
			).toMatchObject({ entity: { properties: ["title"] } });
			for (const invalid of [
				{ event: { properties: ["   "], compareProperties: [] } },
				{},
				{ providerEntityImport: false },
				{ signal: { properties: ["message", "message"] } },
				{
					event: {
						properties: [],
						compareProperties: [
							{ equality: "json", property: "status" },
							{ property: "status", equality: "unordered-array" },
						],
					},
				},
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(AutomationAfterInputProjection)(invalid));
			}
		}),
	);

	it.effect("requires changed properties only on projected update invocations", () =>
		Effect.gen(function* () {
			const before = {
				...drafts[0]?.draft,
				id: "entity-1",
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			const payload = {
				before,
				category: "change",
				resource: "entity",
				operation: "update",
				changedProperties: ["count"],
				after: { ...before, properties: { count: 2 } },
			};
			const input = {
				automation: {
					payload,
					causation,
					runId: "run-1",
					occurredAt: timestamp,
					triggerId: "trigger-1",
					hookSlug: "item.changed",
					executionUserId: "user-1",
				},
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationInput)(input)).toEqual(input);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationInput)({
					...input,
					automation: {
						...input.automation,
						payload: { ...payload, changedProperties: undefined },
					},
				}),
			);
			expect(
				yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)({
					after: payload.after,
					before: payload.before,
					category: payload.category,
					resource: payload.resource,
					operation: payload.operation,
				}),
			).toMatchObject({ operation: "update" });
			yield* Effect.flip(Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload));
			const projectedRequest = {
				before,
				resource: "entity",
				category: "request",
				operation: "update",
				changedProperties: ["count"],
				draft: { ...drafts[0]?.draft, properties: { projected: true } },
			};
			expect(
				yield* Schema.decodeUnknownEffect(AutomationPolicyInput)({
					automation: { ...input.automation, payload: projectedRequest },
				}),
			).toMatchObject({ automation: { payload: { changedProperties: ["count"] } } });
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationPolicyInput)({
					automation: {
						...input.automation,
						payload: { ...projectedRequest, changedProperties: undefined },
					},
				}),
			);
			expect(
				yield* Schema.decodeUnknownEffect(AutomationInput)({
					...input,
					automation: {
						...input.automation,
						payload: {
							items: [payload],
							category: "change",
							operation: "batch",
							resource: "entity",
						},
					},
				}),
			).toMatchObject({ automation: { payload: { items: [{ changedProperties: ["count"] }] } } });
		}),
	);

	it.effect.each(drafts)(
		"requires operation-specific $resource drafts and snapshots",
		({ draft, resource }) =>
			Effect.gen(function* () {
				const before = { ...draft, id: "record-1", createdAt: timestamp, updatedAt: timestamp };
				const after = { ...before, properties: { changed: true } };
				for (const payload of [
					{ draft, resource, category: "request", operation: "create" },
					{ draft, before, resource, category: "request", operation: "update" },
					{ resource, draft: before, category: "request", operation: "delete" },
					{ after, resource, category: "change", operation: "create" },
					{ after, before, resource, category: "change", operation: "update" },
					{ before, resource, category: "change", operation: "delete" },
				]) {
					expect(yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload)).toEqual(
						payload,
					);
				}
				for (const payload of [
					{ after, resource, category: "change", operation: "update" },
					{ after, before, resource, category: "change", operation: "create" },
					{ after, resource, category: "change", operation: "delete" },
					{ draft, resource, category: "request", operation: "update" },
					{
						resource,
						category: "request",
						operation: "create",
						draft: { ...draft, parentRunId: "untrusted" },
					},
					{ after, resource, operation: "emit", category: "signal" },
				]) {
					yield* Effect.flip(Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload));
				}
			}),
	);

	it.effect(
		"keeps provider completion user-scoped and signal actors independent of optional subjects",
		() =>
			Effect.gen(function* () {
				const completion = {
					userId: "user-1",
					category: "change",
					entityId: "entity-1",
					operation: "complete",
					entitySchemaSlug: "item",
					providerId: "provider-1",
					externalId: "external-1",
					entitySchemaPluginId: null,
					resource: "provider-entity-import",
				};
				const signal = {
					properties: {},
					operation: "emit",
					actorUserId: null,
					category: "signal",
					resource: "signal",
					signalSchemaPluginId: null,
					signalSchemaSlug: "changed",
				};
				expect(yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)(completion)).toEqual(
					completion,
				);
				expect(yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)(signal)).toEqual(signal);
				expect(
					yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)({
						...signal,
						subjectEntityId: "entity-1",
					}),
				).toMatchObject({ subjectEntityId: "entity-1" });
				for (const payload of [
					{ ...completion, userId: null },
					{ ...completion, category: "request" },
					{ ...completion, operation: "create" },
					{ ...signal, operation: "signal" },
					{ ...signal, actorUserId: undefined },
					{ ...signal, signalSchemaPluginId: undefined },
				]) {
					yield* Effect.flip(Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload));
				}
			}),
	);

	it.effect("preserves integration attribution and requires direct automation parents", () =>
		Effect.gen(function* () {
			const child = {
				...causation,
				depth: 1,
				source: "automation",
				parentRunId: "run-1",
				importRunId: "import-1",
				executionId: "child-command",
				parentTriggerId: "trigger-1",
				integrationId: "integration-1",
				providerExecutionId: "provider-execution-1",
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationCausation)(child)).toEqual(child);
			for (const invalid of [
				{ ...child, parentRunId: null },
				{ ...child, parentTriggerId: null },
				{ ...child, depth: 0 },
				{ ...child, lane: "urgent" },
				{ ...causation, depth: -1 },
				{ ...causation, origin: { kind: "api" } },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(AutomationCausation)(invalid));
			}
		}),
	);

	it.effect(
		"retains trigger attribution after payload pruning and rejects conflicting summaries",
		() =>
			Effect.gen(function* () {
				const payload = {
					properties: {},
					operation: "emit",
					category: "signal",
					resource: "signal",
					actorUserId: "user-1",
					signalSchemaSlug: "changed",
					signalSchemaPluginId: PluginId.make("plugin-1"),
				};
				const trigger = {
					payload,
					causation,
					id: "trigger-1",
					blockedReason: null,
					createdAt: timestamp,
					scopeUserId: "user-1",
					occurredAt: timestamp,
					payloadPrunedAt: null,
					kind: { operation: "emit", category: "signal", resource: "signal" },
				};
				expect(yield* Schema.decodeUnknownEffect(AutomationTrigger)(trigger)).toMatchObject({
					payload,
				});
				expect(
					yield* Schema.decodeUnknownEffect(AutomationTrigger)({
						...trigger,
						payload: null,
						payloadPrunedAt: timestamp,
					}),
				).toMatchObject({ kind: trigger.kind });
				yield* Effect.flip(
					Schema.decodeUnknownEffect(AutomationTrigger)({
						...trigger,
						kind: { category: "change", resource: "entity", operation: "create" },
					}),
				);
			}),
	);

	it.effect("carries one write's changes as a single-resource, non-empty batch payload", () =>
		Effect.gen(function* () {
			const relationship = {
				properties: {},
				id: "relationship-1",
				createdAt: timestamp,
				updatedAt: timestamp,
				sourceEntityId: "entity-1",
				targetEntityId: "entity-2",
				relationshipSchemaPluginId: null,
				relationshipSchemaSlug: "contains",
			};
			const item = {
				category: "change",
				after: relationship,
				operation: "create",
				resource: "relationship",
			};
			const payload = {
				items: [item],
				category: "change",
				operation: "batch",
				resource: "relationship",
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationTriggerPayload)(payload)).toEqual(payload);
			for (const invalid of [
				{ ...payload, items: [] },
				{ ...payload, resource: "entity" },
				{ ...payload, resource: "provider-entity-import" },
				{
					...payload,
					items: [
						item,
						{ ...item, resource: "entity", after: { ...relationship, id: "entity-3" } },
					],
				},
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(AutomationTriggerPayload)(invalid));
			}
			const trigger = {
				payload,
				causation,
				id: "trigger-1",
				scopeUserId: null,
				blockedReason: null,
				createdAt: timestamp,
				occurredAt: timestamp,
				payloadPrunedAt: null,
				kind: { category: "change", operation: "batch", resource: "relationship" },
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationTrigger)(trigger)).toMatchObject({
				payload,
			});
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationTrigger)({
					...trigger,
					kind: { category: "change", operation: "batch", resource: "entity" },
				}),
			);
		}),
	);

	it.effect("bounds retry settings and disallows arbitrary retry expressions", () =>
		Effect.gen(function* () {
			for (const retry of [
				{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 11 },
				{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 0 },
				{ ...DEFAULT_AUTOMATION_RETRY_POLICY, initialDelayMs: 60_001 },
				{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxDelayMs: Infinity },
				{ ...DEFAULT_AUTOMATION_RETRY_POLICY, expression: "retry()" },
			]) {
				yield* Effect.flip(Schema.decodeEffect(AutomationRetryPolicy)(retry));
			}
		}),
	);

	it.effect("limits warning disclosure to stable identities", () =>
		Effect.gen(function* () {
			const blocked = {
				hasRequiredHooks: true,
				triggerId: "trigger-1",
				code: "automation-limit-reached",
				omittedHooks: [
					{ pluginId: null, hookSlug: "automation.notification" },
					{ pluginId: "plugin-1", hookSlug: "automation.notification" },
				],
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationWarning)(blocked)).toEqual(blocked);
			const warning = { runId: "run-1", hookSlug: "item.notify", code: "required-hook-failed" };
			expect(yield* Schema.decodeUnknownEffect(AutomationWarning)(warning)).toEqual(warning);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(AutomationWarning)({ ...warning, error: "secret" }),
			);
			yield* Effect.flip(
				Schema.decodeEffect(AutomationWarning)({
					triggerId: "trigger-1",
					hasRequiredHooks: false,
					code: "automation-limit-reached",
					omittedHooks: Array.from({ length: 101 }, () => ({
						pluginId: "plugin-1",
						hookSlug: "item.notify",
					})),
				}),
			);
		}),
	);

	it.effect("uses explicit policy rejection and strict resource-tagged patches", () =>
		Effect.gen(function* () {
			const transform = {
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						sessionEntityId: null,
						occurredAt: "2026-09-16T00:00:00.000Z",
						properties: { remove: ["stale"], set: { progress: 100 } },
					},
				},
			};
			expect(yield* Schema.decodeUnknownEffect(AutomationPolicyOutput)(transform)).toEqual(
				transform,
			);
			expect(
				yield* Schema.decodeEffect(AutomationPolicyOutput)({
					action: "transform",
					patch: { resource: "entity", draft: { name: "Updated" } },
				}),
			).toMatchObject({ patch: { resource: "entity" } });
			expect(
				yield* Schema.decodeEffect(AutomationPolicyOutput)({
					action: "transform",
					patch: {
						resource: "relationship",
						draft: { properties: { remove: [], set: { role: "owner" } } },
					},
				}),
			).toMatchObject({ patch: { resource: "relationship" } });
			expect(
				yield* Schema.decodeEffect(AutomationPolicyOutput)({
					action: "reject",
					reason: "Invalid progress",
				}),
			).toEqual({ action: "reject", reason: "Invalid progress" });
			for (const old of [
				{ action: "skip", reason: "Invalid progress" },
				{ action: "replace", body: { properties: {} } },
				{ action: "transform" },
				{ action: "transform", patch: { draft: {}, resource: "event" } },
				{ action: "transform", patch: { resource: "event", draft: { entityId: "entity-2" } } },
				{
					action: "transform",
					patch: { resource: "event", draft: { eventSchemaSlug: "another-event" } },
				},
				{
					action: "transform",
					patch: { resource: "event", draft: { entitySchemaSlug: "another-entity" } },
				},
				{
					action: "transform",
					patch: { resource: "entity", draft: { externalId: "not-allowed" } },
				},
				{ action: "transform", patch: { resource: "entity", draft: { providerId: null } } },
				{ action: "transform", patch: { resource: "entity", draft: { populatedAt: null } } },
				{
					action: "transform",
					patch: { resource: "entity", draft: { properties: { set: {}, remove: [] } } },
				},
				{
					action: "transform",
					patch: { resource: "entity", draft: { properties: { set: {}, remove: ["tag", "tag"] } } },
				},
				{
					action: "transform",
					patch: {
						resource: "entity",
						draft: { properties: { remove: ["tag"], set: { tag: true } } },
					},
				},
				{ action: "transform", patch: { resource: "signal", draft: { properties: {} } } },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(AutomationPolicyOutput)(old));
			}
		}),
	);
});
