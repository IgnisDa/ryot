import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	AutomationCausation,
	AutomationInput,
	AutomationPolicyInput,
	AutomationRun,
	AutomationRunAttempt,
	AutomationPolicyOutput,
	AutomationRetryPolicy,
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
		},
	},
	{
		resource: "event",
		draft: {
			entityId: "entity-1",
			occurredAt: timestamp,
			sessionEntityId: null,
			entitySchemaSlug: "item",
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
			relationshipSchemaSlug: "contains",
		},
	},
];

describe("lifecycle payload boundaries", () => {
	it("records pinned run attribution without permitting delayed policy attempts", () => {
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
		expect(Schema.decodeUnknownSync(AutomationRun)(run)).toEqual(run);
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
				expect(Schema.decodeUnknownSync(AutomationRun)(kernelRun)).toEqual(kernelRun);
				if (sandboxScriptId === null) {
					for (const status of ["queued", "running"]) {
						expect(() =>
							Schema.decodeUnknownSync(AutomationRun)({ ...kernelRun, status }),
						).toThrow();
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
						expect(() =>
							Schema.decodeUnknownSync(AutomationRun)({
								...run,
								...stage,
								pluginId,
								pluginRevisionId,
								pluginConfigRevisionId,
							}),
						).toThrow();
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
			expect(() => Schema.decodeUnknownSync(AutomationRun)({ ...run, ...change })).toThrow();
		}
		expect(() =>
			Schema.decodeUnknownSync(AutomationRun)({
				...run,
				stage: "after",
				delivery: "async",
				sandboxScriptId: null,
				nextAttemptAt: timestamp,
				retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
			}),
		).toThrow();
		expect(
			Schema.decodeUnknownSync(AutomationRun)({
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
	});

	it("retains numbered attempt outcomes when large artifacts are pruned", () => {
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
		expect(Schema.decodeUnknownSync(AutomationRunAttempt)(attempt)).toEqual(attempt);
		expect(() =>
			Schema.decodeUnknownSync(AutomationRunAttempt)({ ...attempt, attemptNumber: 0 }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(AutomationRunAttempt)({
				...attempt,
				timing: { ...attempt.timing, executionMs: -1 },
			}),
		).toThrow();
	});

	it.each(drafts.filter(({ resource }) => resource !== "event"))(
		"retains provider monitoring context on $resource changes with exact snapshots",
		({ draft, resource }) => {
			const snapshot = { ...draft, id: "entity-1", createdAt: timestamp, updatedAt: timestamp };
			const population = {
				rootPreviouslyPopulated: true,
				scopeEntity: { id: "show-1", name: "Show", entitySchemaSlug: "show" },
				parentEntity: { name: "Season", properties: { season: 2 }, entitySchemaSlug: "season" },
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
				expect(Schema.decodeUnknownSync(AutomationTriggerPayload)(payload)).toEqual(payload);
				for (const invalid of [
					{ ...payload, population: { ...population, rootPreviouslyPopulated: undefined } },
					{
						...payload,
						population: { ...population, batch: { ...population.batch, createdCount: -1 } },
					},
					{ ...payload, after: undefined, before: undefined },
				]) {
					expect(() => Schema.decodeUnknownSync(AutomationTriggerPayload)(invalid)).toThrow();
				}
			}
			expect(() =>
				Schema.decodeUnknownSync(AutomationTriggerPayload)({
					draft,
					resource,
					population,
					category: "request",
					operation: "create",
				}),
			).toThrow();
		},
	);

	it("requires the trusted execution principal in policy and after invocations", () => {
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
				expect(Schema.decodeUnknownSync(schema)(input)).toEqual(input);
				expect(() =>
					Schema.decodeUnknownSync(schema)({
						automation: { ...input.automation, executionUserId: undefined },
					}),
				).toThrow();
			}
		}
	});

	it.each(drafts)(
		"requires operation-specific $resource drafts and snapshots",
		({ draft, resource }) => {
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
				expect(Schema.decodeUnknownSync(AutomationTriggerPayload)(payload)).toEqual(payload);
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
				expect(() => Schema.decodeUnknownSync(AutomationTriggerPayload)(payload)).toThrow();
			}
		},
	);

	it("keeps provider completion user-scoped and signal actors independent of optional subjects", () => {
		const completion = {
			userId: "user-1",
			category: "change",
			entityId: "entity-1",
			operation: "complete",
			entitySchemaSlug: "item",
			providerId: "provider-1",
			externalId: "external-1",
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
		expect(Schema.decodeUnknownSync(AutomationTriggerPayload)(completion)).toEqual(completion);
		expect(Schema.decodeUnknownSync(AutomationTriggerPayload)(signal)).toEqual(signal);
		expect(
			Schema.decodeUnknownSync(AutomationTriggerPayload)({
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
			expect(() => Schema.decodeUnknownSync(AutomationTriggerPayload)(payload)).toThrow();
		}
	});

	it("preserves integration attribution and requires direct automation parents", () => {
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
		expect(Schema.decodeUnknownSync(AutomationCausation)(child)).toEqual(child);
		for (const invalid of [
			{ ...child, parentRunId: null },
			{ ...child, parentTriggerId: null },
			{ ...child, depth: 0 },
			{ ...causation, depth: -1 },
			{ ...causation, origin: { kind: "api" } },
		]) {
			expect(() => Schema.decodeUnknownSync(AutomationCausation)(invalid)).toThrow();
		}
	});

	it("retains trigger attribution after payload pruning and rejects conflicting summaries", () => {
		const payload = {
			properties: {},
			operation: "emit",
			category: "signal",
			resource: "signal",
			actorUserId: "user-1",
			signalSchemaSlug: "changed",
			signalSchemaPluginId: "plugin-1",
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
		expect(Schema.decodeUnknownSync(AutomationTrigger)(trigger)).toMatchObject({ payload });
		expect(
			Schema.decodeUnknownSync(AutomationTrigger)({
				...trigger,
				payload: null,
				payloadPrunedAt: timestamp,
			}),
		).toMatchObject({ kind: trigger.kind });
		expect(() =>
			Schema.decodeUnknownSync(AutomationTrigger)({
				...trigger,
				kind: { category: "change", resource: "entity", operation: "create" },
			}),
		).toThrow();
	});

	it("carries one write's changes as a single-resource, non-empty batch payload", () => {
		const relationship = {
			properties: {},
			id: "relationship-1",
			createdAt: timestamp,
			updatedAt: timestamp,
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
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
		expect(Schema.decodeUnknownSync(AutomationTriggerPayload)(payload)).toEqual(payload);
		for (const invalid of [
			{ ...payload, items: [] },
			{ ...payload, resource: "entity" },
			{ ...payload, resource: "provider-entity-import" },
			{
				...payload,
				items: [item, { ...item, resource: "entity", after: { ...relationship, id: "entity-3" } }],
			},
		]) {
			expect(() => Schema.decodeUnknownSync(AutomationTriggerPayload)(invalid)).toThrow();
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
		expect(Schema.decodeUnknownSync(AutomationTrigger)(trigger)).toMatchObject({ payload });
		expect(() =>
			Schema.decodeUnknownSync(AutomationTrigger)({
				...trigger,
				kind: { category: "change", operation: "batch", resource: "entity" },
			}),
		).toThrow();
	});

	it("bounds retry settings and disallows arbitrary retry expressions", () => {
		for (const retry of [
			{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 11 },
			{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 0 },
			{ ...DEFAULT_AUTOMATION_RETRY_POLICY, initialDelayMs: 60_001 },
			{ ...DEFAULT_AUTOMATION_RETRY_POLICY, maxDelayMs: Infinity },
			{ ...DEFAULT_AUTOMATION_RETRY_POLICY, expression: "retry()" },
		]) {
			expect(() => Schema.decodeUnknownSync(AutomationRetryPolicy)(retry)).toThrow();
		}
	});

	it("limits warning disclosure to stable identities", () => {
		const blocked = {
			hasRequiredHooks: true,
			triggerId: "trigger-1",
			code: "automation-limit-reached",
			omittedHooks: [
				{ pluginId: null, hookSlug: "automation.notification" },
				{ pluginId: "plugin-1", hookSlug: "automation.notification" },
			],
		};
		expect(Schema.decodeUnknownSync(AutomationWarning)(blocked)).toEqual(blocked);
		const warning = { runId: "run-1", hookSlug: "item.notify", code: "required-hook-failed" };
		expect(Schema.decodeUnknownSync(AutomationWarning)(warning)).toEqual(warning);
		expect(() =>
			Schema.decodeUnknownSync(AutomationWarning)({ ...warning, error: "secret" }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(AutomationWarning)({
				triggerId: "trigger-1",
				hasRequiredHooks: false,
				code: "automation-limit-reached",
				omittedHooks: Array.from({ length: 101 }, () => ({
					pluginId: "plugin-1",
					hookSlug: "item.notify",
				})),
			}),
		).toThrow();
	});

	it("uses explicit policy rejection and full validated transform proposals", () => {
		const transform = {
			action: "transform",
			payload: {
				resource: "event",
				category: "request",
				operation: "create",
				draft: drafts[1]?.draft,
			},
		};
		expect(Schema.decodeUnknownSync(AutomationPolicyOutput)(transform)).toEqual(transform);
		expect(
			Schema.decodeUnknownSync(AutomationPolicyOutput)({
				action: "reject",
				reason: "Invalid progress",
			}),
		).toEqual({ action: "reject", reason: "Invalid progress" });
		for (const old of [
			{ action: "skip", reason: "Invalid progress" },
			{ action: "replace", body: { properties: {} } },
		]) {
			expect(() => Schema.decodeUnknownSync(AutomationPolicyOutput)(old)).toThrow();
		}
	});
});
