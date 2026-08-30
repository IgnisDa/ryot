import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationHookSlug,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	deleteSandboxReplayProjection,
	enqueueSandboxScript,
	installTestPluginBundle,
	listAutomationRunAttempts,
	listAutomationRuns,
	listAutomationTriggers,
	listEventsForEntity,
	pollAutomationRuns,
	pollSandboxResult,
	pollTerminalAutomationRunAttempts,
	pollTerminalAutomationRuns,
	postApiJson,
	requireCompletedSandboxValue,
	type AutomationTrigger,
	type AutomationTriggerFilter,
	type Client,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

type CreateEventsPayload = ContractPayload<"events", "create">;
type CreateEventsResult = ContractSuccess<"events", "create">;
type EventInput = CreateEventsPayload[number];
type SourceRecord = Extract<
	NonNullable<AutomationTriggerFilter["sourceRecord"]>,
	{ readonly resource: "entity" | "event" | "relationship" }
>;
type PluginScript = PluginManifest["scripts"][number];
type TriggerPayload = NonNullable<AutomationTrigger["payload"]>;
type EventCreateRequestPayload = Extract<
	TriggerPayload,
	{ readonly category: "request"; readonly operation: "create"; readonly resource: "event" }
>;

const suffix = crypto.randomUUID();
const slugs = {
	plugin: `e2e-lifecycle-${suffix}`,
	entity: `lifecycle-entity-${suffix}`,
	asyncEvent: `lifecycle-async-${suffix}`,
	policyEvent: `lifecycle-policy-${suffix}`,
	fanoutEvent: `lifecycle-fanout-${suffix}`,
	replayEvent: `lifecycle-replay-${suffix}`,
	asyncHook: `lifecycle-async-hook-${suffix}`,
	requiredEvent: `lifecycle-required-${suffix}`,
	slowScript: `lifecycle-slow-script-${suffix}`,
	policyHook: `lifecycle-policy-hook-${suffix}`,
	entityHook: `lifecycle-entity-hook-${suffix}`,
	replayHook: `lifecycle-replay-hook-${suffix}`,
	replayPause: `lifecycle-replay-pause-${suffix}`,
	relationship: `lifecycle-relationship-${suffix}`,
	policyScript: `lifecycle-policy-script-${suffix}`,
	requiredHook: `lifecycle-required-hook-${suffix}`,
	successScript: `lifecycle-success-script-${suffix}`,
	failureScript: `lifecycle-failure-script-${suffix}`,
	policyAfterHook: `lifecycle-policy-after-${suffix}`,
	replayOperation: `lifecycle-replay-operation-${suffix}`,
	fanoutFailureHook: `lifecycle-fanout-failure-${suffix}`,
	fanoutSuccessHook: `lifecycle-fanout-success-${suffix}`,
	relationshipHook: `lifecycle-relationship-hook-${suffix}`,
} as const;

const entries = {
	slow: "backend/automations/lifecycle-slow.sandbox.ts",
	policy: "backend/automations/lifecycle-policy.sandbox.ts",
	success: "backend/automations/lifecycle-success.sandbox.ts",
	failure: "backend/automations/lifecycle-failure.sandbox.ts",
	replayOperation: "backend/operations/lifecycle-replay.sandbox.ts",
	replayPause: "backend/workflows/lifecycle-replay-pause.sandbox.ts",
} as const;

const automationScript = (
	slug: string,
	entry: string,
	name: string,
	automationType: "automation" | "policy",
): PluginScript => ({
	slug,
	name,
	entry,
	automationType,
	capabilities: [],
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const policySource = `
import { defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "policy",
  slug: ${JSON.stringify(slugs.policyScript)},
  name: "E2E lifecycle policy",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomationPolicy({
  manifest,
  run: ({ automation }) => Effect.gen(function* () {
    const payload = automation.payload;
    if (payload.resource !== "event" || payload.operation !== "create") {
      return { action: "allow" };
    }
    const marker = payload.draft.properties.marker;
    if (marker === "reject") {
      return { action: "reject", reason: "fixture-policy-rejection" };
    }
    if (marker === "fail") {
      return yield* Effect.fail(new Error("fixture policy execution failure"));
    }
    if (marker === "transform") {
      return {
        action: "transform",
        payload: {
          ...payload,
          draft: { ...payload.draft, properties: { marker: "transformed" } },
        },
      };
    }
    return { action: "allow" };
  }),
});
`;

const afterSource = (input: {
	readonly name: string;
	readonly slug: string;
	readonly body: string;
}) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  slug: ${JSON.stringify(input.slug)},
  name: ${JSON.stringify(input.name)},
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineAutomation({
  manifest,
  run: () => ${input.body},
});
`;

const replayOperationSource = `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";

export const manifest = defineManifest({
  kind: "operation",
  slug: ${JSON.stringify(slugs.replayOperation)},
  name: "E2E lifecycle replay operation",
  capabilities: ["createEvents"],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineOperation({
  manifest,
  output: Schema.Unknown,
  input: Schema.Struct({ entityId: Schema.String, eventSchemaSlug: Schema.String }),
  run: (input, host) => Effect.gen(function* () {
    const result = yield* host.createEvents([{
      entityId: input.entityId,
      eventSchemaSlug: input.eventSchemaSlug,
      properties: { marker: "replayed" },
      occurredAt: "2026-09-16T06:00:00.000Z",
    }]);
    if (!host.executeWorkflow) {
      return yield* Effect.fail(new Error("executeWorkflow is unavailable"));
    }
    yield* host.executeWorkflow(
      ${JSON.stringify(slugs.replayPause)},
      {
        workflowSlug: ${JSON.stringify(slugs.replayPause)},
        input: Schema.Struct({ value: Schema.String }),
        output: Schema.String,
      },
      { value: input.entityId },
    );
    return result;
  }),
});
`;

const replayPauseSource = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

export const manifest = defineManifest({
  kind: "workflow",
  slug: ${JSON.stringify(slugs.replayPause)},
  name: "E2E lifecycle replay pause",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
});

export default defineWorkflow({
  manifest,
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.String,
  run: (input, replay) => replay.sleep("lifecycle-replay-pause", 5000).pipe(
    Effect.as(input.value),
  ),
});
`;

const markerSchema = {
	unknownKeys: "strict" as const,
	fields: {
		marker: {
			label: "Marker",
			type: "string" as const,
			description: "E2E lifecycle marker",
			validation: { required: true as const },
		},
	},
};

const eventSchema = (slug: string, name: string) => ({
	slug,
	name,
	propertiesSchema: markerSchema,
});

const scripts = [
	automationScript(slugs.policyScript, entries.policy, "E2E lifecycle policy", "policy"),
	automationScript(slugs.successScript, entries.success, "E2E lifecycle success", "automation"),
	automationScript(slugs.failureScript, entries.failure, "E2E lifecycle failure", "automation"),
	automationScript(slugs.slowScript, entries.slow, "E2E lifecycle slow hook", "automation"),
	{
		kind: "operation",
		slug: slugs.replayOperation,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		entry: entries.replayOperation,
		capabilities: ["createEvents"],
		name: "E2E lifecycle replay operation",
	},
	{
		kind: "workflow",
		capabilities: [],
		slug: slugs.replayPause,
		entry: entries.replayPause,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		name: "E2E lifecycle replay pause",
	},
] satisfies PluginManifest["scripts"];

const installLifecyclePlugin = () =>
	installTestPluginBundle({
		scripts,
		scope: "system",
		pluginSlug: slugs.plugin,
		workflows: [{ slug: slugs.replayPause, scriptSlug: slugs.replayPause }],
		operations: [
			{
				auth: "user",
				slug: slugs.replayOperation,
				scriptSlug: slugs.replayOperation,
				description: "Replays one lifecycle event workflow",
			},
		],
		relationshipSchemas: [
			{
				slug: slugs.relationship,
				propertiesSchema: markerSchema,
				name: "E2E Lifecycle Relationship",
				sourceEntitySchemaSlug: slugs.entity,
				targetEntitySchemaSlug: slugs.entity,
			},
		],
		entitySchemas: [
			{
				icon: "box",
				slug: slugs.entity,
				name: "E2E Lifecycle Entity",
				propertiesSchema: markerSchema,
				eventSchemas: [
					eventSchema(slugs.policyEvent, "Policy event"),
					eventSchema(slugs.requiredEvent, "Required event"),
					eventSchema(slugs.fanoutEvent, "Fan-out event"),
					eventSchema(slugs.asyncEvent, "Async event"),
					eventSchema(slugs.replayEvent, "Replay event"),
				],
			},
		],
		files: {
			[entries.policy]: policySource,
			[entries.replayPause]: replayPauseSource,
			[entries.replayOperation]: replayOperationSource,
			[entries.success]: afterSource({
				slug: slugs.successScript,
				body: "Effect.succeed(null)",
				name: "E2E lifecycle success",
			}),
			[entries.slow]: afterSource({
				slug: slugs.slowScript,
				name: "E2E lifecycle slow hook",
				body: "Effect.sleep(6000).pipe(Effect.as(null))",
			}),
			[entries.failure]: afterSource({
				slug: slugs.failureScript,
				name: "E2E lifecycle failure",
				body: 'Effect.fail(new Error("fixture required hook failure"))',
			}),
		},
		hooks: [
			{
				position: 10,
				stage: "before",
				slug: slugs.policyHook,
				scriptSlug: slugs.policyScript,
				name: "E2E lifecycle request policy",
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.policyEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "async",
				slug: slugs.entityHook,
				scriptSlug: slugs.successScript,
				name: "E2E entity snapshot hook",
				targets: [{ resource: "entity", operation: "create", entitySchemaSlug: slugs.entity }],
			},
			{
				stage: "after",
				delivery: "async",
				slug: slugs.policyAfterHook,
				scriptSlug: slugs.successScript,
				name: "E2E event snapshot hook",
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.policyEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "async",
				slug: slugs.relationshipHook,
				scriptSlug: slugs.successScript,
				name: "E2E relationship snapshot hook",
				targets: [
					{
						operation: "create",
						resource: "relationship",
						relationshipSchemaSlug: slugs.relationship,
					},
				],
			},
			{
				stage: "after",
				delivery: "required",
				slug: slugs.requiredHook,
				scriptSlug: slugs.failureScript,
				name: "E2E required failure hook",
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.requiredEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "required",
				name: "E2E fan-out failure",
				slug: slugs.fanoutFailureHook,
				scriptSlug: slugs.failureScript,
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.fanoutEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "required",
				name: "E2E fan-out success",
				slug: slugs.fanoutSuccessHook,
				scriptSlug: slugs.successScript,
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.fanoutEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "async",
				slug: slugs.asyncHook,
				name: "E2E slow async hook",
				scriptSlug: slugs.slowScript,
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.asyncEvent,
					},
				],
			},
			{
				stage: "after",
				delivery: "async",
				slug: slugs.replayHook,
				scriptSlug: slugs.successScript,
				name: "E2E replay observation hook",
				targets: [
					{
						resource: "event",
						operation: "create",
						entitySchemaSlug: slugs.entity,
						eventSchemaSlug: slugs.replayEvent,
					},
				],
			},
		],
	});

const createFixtureEntity = (client: Client, marker: string = crypto.randomUUID()) =>
	createEntity(client, {
		properties: { marker },
		name: `Lifecycle ${marker}`,
		entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
	});

const eventInput = (
	entityId: EventInput["entityId"],
	eventSchemaSlug: string,
	marker: string,
	occurredAt: string,
): EventInput => ({
	entityId,
	occurredAt,
	properties: { marker },
	eventSchemaSlug: EventSchemaSlug.make(eventSchemaSlug),
});

const eventRequestPayload = (input: EventInput): EventCreateRequestPayload => {
	const properties = input.properties;
	if (
		properties === null ||
		typeof properties !== "object" ||
		Array.isArray(properties) ||
		typeof Reflect.get(properties, "marker") !== "string"
	) {
		throw new Error("Fixture event requires a string marker");
	}
	return {
		resource: "event",
		category: "request",
		operation: "create",
		excludedOncePerSubjectPolicies: [],
		draft: {
			sessionEntityId: null,
			entityId: input.entityId,
			eventSchemaSlug: input.eventSchemaSlug,
			entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
			properties: { marker: Reflect.get(properties, "marker") },
			occurredAt: requirePresent(input.occurredAt, "Fixture event requires occurredAt"),
		},
	};
};

const createEvents = (client: Client, payload: CreateEventsPayload) =>
	client.call((c) => c.events.create({ payload }));

const requireWrittenEventId = (result: CreateEventsResult, index = 0) => {
	const outcome = requirePresent(
		result.outcomes.find((candidate) => candidate.index === index),
		`Event outcome ${index} was not returned`,
	);
	if (outcome.status !== "written") {
		throw new Error(`Event outcome ${index} was not written`);
	}
	return outcome.eventId;
};

function requireCreatePayload<
	Category extends "request" | "change",
	Resource extends "entity" | "event" | "relationship",
>(
	trigger: AutomationTrigger,
	category: Category,
	resource: Resource,
): Extract<
	TriggerPayload,
	{ readonly category: Category; readonly operation: "create"; readonly resource: Resource }
>;
function requireCreatePayload(
	trigger: AutomationTrigger,
	category: "request" | "change",
	resource: "entity" | "event" | "relationship",
): TriggerPayload {
	const payload = trigger.payload;
	if (
		payload === null ||
		payload.category !== category ||
		payload.resource !== resource ||
		payload.operation !== "create"
	) {
		throw new Error(`Expected ${category} ${resource} create trigger '${trigger.id}'`);
	}
	return payload;
}

const inspectCommittedCreate = (sourceRecord: SourceRecord, hookSlug: string) =>
	Effect.gen(function* () {
		const changes = yield* listAutomationTriggers({ sourceRecord });
		expect(changes).toHaveLength(1);
		const change = requirePresent(changes[0], "Expected a committed change trigger");
		requireCreatePayload(change, "change", sourceRecord.resource);

		const requestId = requirePresent(
			change.causation.parentTriggerId,
			"Change trigger must link to its request trigger",
		);
		const requests = yield* listAutomationTriggers({ triggerId: requestId });
		expect(requests).toHaveLength(1);
		const request = requirePresent(requests[0], "Expected the linked request trigger");
		requireCreatePayload(request, "request", sourceRecord.resource);

		const runs = yield* listAutomationRuns({
			triggerId: change.id,
			hookSlug: AutomationHookSlug.make(hookSlug),
		});
		expect(runs).toHaveLength(1);
		return { change, request, run: requirePresent(runs[0], "Expected an atomic matching run") };
	});

let installed: InstalledTestPlugin | undefined;

beforeAll(async () => {
	installed = await Effect.runPromise(installLifecyclePlugin());
});

afterAll(async () => {
	if (installed) {
		await Effect.runPromise(uninstallTestPlugin(installed));
	}
});

describe("automation lifecycle triggers", () => {
	it.live("runs request policies and commits only accepted or transformed event drafts", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entity = yield* createFixtureEntity(client, "policy-source");
			const allowed = eventInput(entity.id, slugs.policyEvent, "allow", "2026-09-16T01:00:00.000Z");
			const transformedInput = eventInput(
				entity.id,
				slugs.policyEvent,
				"transform",
				"2026-09-16T01:01:00.000Z",
			);
			const rejected = eventInput(
				entity.id,
				slugs.policyEvent,
				"reject",
				"2026-09-16T01:02:00.000Z",
			);
			const failed = eventInput(entity.id, slugs.policyEvent, "fail", "2026-09-16T01:03:00.000Z");
			const payload = [allowed, transformedInput, rejected, failed] satisfies CreateEventsPayload;

			const result = yield* createEvents(client, payload);
			expect(result).toMatchObject({
				count: 2,
				warnings: [],
				failure: { index: 3, reason: { code: "policy-execution-failed" } },
				outcomes: [
					{ index: 0, status: "written" },
					{ index: 1, status: "written" },
					{ index: 2, status: "skipped_by_policy", reason: "fixture-policy-rejection" },
				],
			});

			const acceptedId = requireWrittenEventId(result, 0);
			const transformedId = requireWrittenEventId(result, 1);
			const accepted = yield* inspectCommittedCreate(
				{ id: acceptedId, resource: "event" },
				slugs.policyAfterHook,
			);
			const transformed = yield* inspectCommittedCreate(
				{ resource: "event", id: transformedId },
				slugs.policyAfterHook,
			);
			expect(accepted.request.payload).toEqual(eventRequestPayload(allowed));
			expect(transformed.request.payload).toEqual(eventRequestPayload(transformedInput));
			const transformedChange = requireCreatePayload(transformed.change, "change", "event");
			expect(transformedChange.after).toMatchObject({
				id: transformedId,
				entityId: entity.id,
				properties: { marker: "transformed" },
				eventSchemaSlug: EventSchemaSlug.make(slugs.policyEvent),
			});

			const rejectedRequest = requirePresent(
				(yield* listAutomationTriggers({ payload: eventRequestPayload(rejected) }))[0],
				"Expected rejected request trigger",
			);
			const rejectedTree = yield* listAutomationTriggers({
				rootExecutionId: rejectedRequest.causation.rootExecutionId,
			});
			expect(
				rejectedTree.filter(
					(trigger) =>
						trigger.id === rejectedRequest.id ||
						trigger.causation.parentTriggerId === rejectedRequest.id,
				),
			).toEqual([rejectedRequest]);
			const rejectedRuns = yield* listAutomationRuns({ triggerId: rejectedRequest.id });
			expect(rejectedRuns).toHaveLength(1);
			expect(rejectedRuns[0]).toMatchObject({
				stage: "before",
				status: "rejected",
				delivery: "policy",
				hookSlug: slugs.policyHook,
			});

			const failedRequest = requirePresent(
				(yield* listAutomationTriggers({ payload: eventRequestPayload(failed) }))[0],
				"Expected failed request trigger",
			);
			const failedTree = yield* listAutomationTriggers({
				rootExecutionId: failedRequest.causation.rootExecutionId,
			});
			expect(
				failedTree.filter(
					(trigger) =>
						trigger.id === failedRequest.id ||
						trigger.causation.parentTriggerId === failedRequest.id,
				),
			).toEqual([failedRequest]);
			const failedRuns = yield* pollTerminalAutomationRuns({ triggerId: failedRequest.id });
			expect(failedRuns).toHaveLength(1);
			expect(failedRuns[0]).toMatchObject({
				stage: "before",
				attemptCount: 1,
				status: "failed",
				retryPolicy: null,
				delivery: "policy",
			});
			const failedRun = requirePresent(failedRuns[0], "Expected failed policy run");
			const attempts = yield* pollTerminalAutomationRunAttempts({ runId: failedRun.id });
			expect(attempts).toHaveLength(1);
			expect(attempts[0]).toMatchObject({ status: "failed", attemptNumber: 1 });

			yield* Effect.sleep(750);
			expect(yield* listAutomationRunAttempts({ runId: failedRun.id })).toHaveLength(1);
			const events = yield* listEventsForEntity(client, entity.id, undefined, 20, {
				eventSchemaSlug: slugs.policyEvent,
			});
			expect(events.map(({ properties }) => properties)).toEqual([
				{ marker: "transformed" },
				{ marker: "allow" },
			]);
		}),
	);

	it.live("stores exact public create snapshots with each source and matching run", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const source = yield* createFixtureEntity(client, "snapshot-source");
			const target = yield* createFixtureEntity(client, "snapshot-target");
			const entityInspection = yield* inspectCommittedCreate(
				{ id: source.id, resource: "entity" },
				slugs.entityHook,
			);
			expect(entityInspection.request.payload).toEqual({
				resource: "entity",
				category: "request",
				operation: "create",
				draft: {
					externalId: null,
					providerId: null,
					name: source.name,
					populatedAt: null,
					properties: { marker: "snapshot-source" },
					entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				},
			});
			expect(entityInspection.change.payload).toEqual({
				category: "change",
				resource: "entity",
				operation: "create",
				after: {
					id: source.id,
					externalId: null,
					providerId: null,
					name: source.name,
					populatedAt: null,
					createdAt: source.createdAt,
					updatedAt: source.updatedAt,
					properties: { marker: "snapshot-source" },
					entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				},
			});

			const event = eventInput(
				source.id,
				slugs.policyEvent,
				"snapshot-event",
				"2026-09-16T02:00:00.000Z",
			);
			const eventResult = yield* createEvents(client, [event]);
			const eventId = requireWrittenEventId(eventResult);
			const eventInspection = yield* inspectCommittedCreate(
				{ id: eventId, resource: "event" },
				slugs.policyAfterHook,
			);
			expect(eventInspection.request.payload).toEqual(eventRequestPayload(event));
			const eventChange = requireCreatePayload(eventInspection.change, "change", "event");
			const { createdAt, updatedAt, ...eventSnapshot } = eventChange.after;
			expect(eventSnapshot).toEqual({
				id: eventId,
				entityId: source.id,
				sessionEntityId: null,
				occurredAt: event.occurredAt,
				properties: { marker: "snapshot-event" },
				entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				eventSchemaSlug: EventSchemaSlug.make(slugs.policyEvent),
			});
			expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(updatedAt).toBe(createdAt);

			const relationship = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				properties: { marker: "snapshot-relationship" },
				relationshipSchemaSlug: RelationshipSchemaSlug.make(slugs.relationship),
			});
			const relationshipInspection = yield* inspectCommittedCreate(
				{ id: relationship.id, resource: "relationship" },
				slugs.relationshipHook,
			);
			expect(relationshipInspection.request.payload).toEqual({
				category: "request",
				operation: "create",
				resource: "relationship",
				draft: {
					sourceEntityId: source.id,
					targetEntityId: target.id,
					properties: { marker: "snapshot-relationship" },
					relationshipSchemaSlug: RelationshipSchemaSlug.make(slugs.relationship),
				},
			});
			expect(relationshipInspection.change.payload).toEqual({
				category: "change",
				operation: "create",
				resource: "relationship",
				after: {
					id: relationship.id,
					sourceEntityId: source.id,
					targetEntityId: target.id,
					createdAt: relationship.createdAt,
					updatedAt: relationship.createdAt,
					properties: { marker: "snapshot-relationship" },
					relationshipSchemaSlug: RelationshipSchemaSlug.make(slugs.relationship),
				},
			});
		}),
	);

	it.live("keeps direct HTTP and contract-client lifecycle behavior in parity", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const entity = yield* createFixtureEntity(client, "parity-source");
			const item = eventInput(entity.id, slugs.policyEvent, "allow", "2026-09-16T03:00:00.000Z");
			const contractResult = yield* createEvents(client, [item]);
			const response = yield* Effect.promise(() => postApiJson("/events", [item], token));
			expect(response.status).toBe(201);
			const rawResult = yield* Schema.decodeUnknownEffect(CreateEventsResponse)(
				yield* Effect.promise(() => response.json()),
			);

			for (const result of [contractResult, rawResult]) {
				expect(result).toMatchObject({
					count: 1,
					warnings: [],
					failure: null,
					outcomes: [{ index: 0, status: "written" }],
				});
			}
			const contractInspection = yield* inspectCommittedCreate(
				{ resource: "event", id: requireWrittenEventId(contractResult) },
				slugs.policyAfterHook,
			);
			const rawInspection = yield* inspectCommittedCreate(
				{ resource: "event", id: requireWrittenEventId(rawResult) },
				slugs.policyAfterHook,
			);
			expect(contractInspection.request.payload).toEqual(eventRequestPayload(item));
			expect(rawInspection.request.payload).toEqual(contractInspection.request.payload);
			expect(rawInspection.run).toMatchObject({
				stage: contractInspection.run.stage,
				delivery: contractInspection.run.delivery,
				hookSlug: contractInspection.run.hookSlug,
			});
		}),
	);

	it.live(
		"returns required warnings while committing sources and runs independent post hooks",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const entity = yield* createFixtureEntity(client, "required-source");
				const requiredResult = yield* createEvents(client, [
					eventInput(entity.id, slugs.requiredEvent, "required", "2026-09-16T04:00:00.000Z"),
				]);
				const requiredId = requireWrittenEventId(requiredResult);
				const requiredTriggers = yield* listAutomationTriggers({
					sourceRecord: { id: requiredId, resource: "event" },
				});
				const requiredTrigger = requirePresent(
					requiredTriggers[0],
					"Expected required change trigger",
				);
				const requiredRuns = yield* pollTerminalAutomationRuns({ triggerId: requiredTrigger.id });
				expect(requiredRuns).toHaveLength(1);
				const requiredRun = requirePresent(requiredRuns[0], "Expected required run");
				expect(requiredResult.warnings).toEqual([
					{
						runId: requiredRun.id,
						code: "required-hook-failed",
						hookSlug: AutomationHookSlug.make(slugs.requiredHook),
					},
				]);
				expect(requiredRun).toMatchObject({ status: "failed", delivery: "required" });
				expect(yield* pollTerminalAutomationRunAttempts({ runId: requiredRun.id })).toHaveLength(1);
				expect(
					(yield* listEventsForEntity(client, entity.id, undefined, 20, {
						eventSchemaSlug: slugs.requiredEvent,
					})).map(({ id }) => id),
				).toEqual([requiredId]);

				const fanoutResult = yield* createEvents(client, [
					eventInput(entity.id, slugs.fanoutEvent, "fanout", "2026-09-16T04:01:00.000Z"),
				]);
				const fanoutId = requireWrittenEventId(fanoutResult);
				const fanoutTrigger = requirePresent(
					(yield* listAutomationTriggers({ sourceRecord: { id: fanoutId, resource: "event" } }))[0],
					"Expected fan-out change trigger",
				);
				const fanoutRuns = yield* pollTerminalAutomationRuns({ triggerId: fanoutTrigger.id });
				expect(fanoutRuns).toHaveLength(2);
				expect(
					fanoutRuns
						.map(({ status, hookSlug }) => ({ status, hookSlug }))
						.sort((left, right) => left.hookSlug.localeCompare(right.hookSlug)),
				).toEqual(
					[
						{ status: "failed", hookSlug: slugs.fanoutFailureHook },
						{ status: "succeeded", hookSlug: slugs.fanoutSuccessHook },
					].sort((left, right) => left.hookSlug.localeCompare(right.hookSlug)),
				);
				expect(fanoutResult.warnings).toEqual([
					{
						code: "required-hook-failed",
						hookSlug: AutomationHookSlug.make(slugs.fanoutFailureHook),
						runId: requirePresent(
							fanoutRuns.find(({ hookSlug }) => hookSlug === slugs.fanoutFailureHook),
							"Expected fan-out failure run",
						).id,
					},
				]);
				for (const run of fanoutRuns) {
					expect(yield* pollTerminalAutomationRunAttempts({ runId: run.id })).toHaveLength(1);
				}
			}),
	);

	it.live("returns before an async hook finishes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const entity = yield* createFixtureEntity(client, "async-source");
			const startedAt = yield* Clock.currentTimeMillis;
			const result = yield* createEvents(client, [
				eventInput(entity.id, slugs.asyncEvent, "async", "2026-09-16T05:00:00.000Z"),
			]);
			const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
			const eventId = requireWrittenEventId(result);
			const trigger = requirePresent(
				(yield* listAutomationTriggers({ sourceRecord: { id: eventId, resource: "event" } }))[0],
				"Expected async change trigger",
			);
			const immediateRuns = yield* listAutomationRuns({
				triggerId: trigger.id,
				hookSlug: AutomationHookSlug.make(slugs.asyncHook),
			});
			expect(immediateRuns).toHaveLength(1);
			expect(["queued", "running"]).toContain(immediateRuns[0]?.status);
			expect(elapsedMs).toBeLessThan(5_000);
			const terminalRuns = yield* pollTerminalAutomationRuns({ triggerId: trigger.id });
			expect(terminalRuns).toMatchObject([{ delivery: "async", status: "succeeded" }]);
			const run = requirePresent(terminalRuns[0], "Expected terminal async run");
			expect(yield* pollTerminalAutomationRunAttempts({ runId: run.id })).toHaveLength(1);
		}),
	);

	it.live("does not duplicate a trigger or run when the trusted event workflow replays", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const entity = yield* createFixtureEntity(client, "replay-source");
			const plugin = requirePresent(installed, "Lifecycle plugin was not installed");
			const scriptId = requirePresent(
				plugin.scriptIds[slugs.replayOperation],
				"Replay operation script was not installed",
			);
			const { jobId, executionId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { entityId: entity.id, eventSchemaSlug: EventSchemaSlug.make(slugs.replayEvent) },
			});
			const initialRuns = yield* pollAutomationRuns({
				executionUserId: client.userId,
				hookSlug: AutomationHookSlug.make(slugs.replayHook),
			});
			expect(initialRuns).toHaveLength(1);
			expect((yield* deleteSandboxReplayProjection(executionId)).deleted).toBe(true);
			requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, jobId),
				"lifecycle replay operation",
			);

			const replayRuns = yield* pollTerminalAutomationRuns({
				executionUserId: client.userId,
				hookSlug: AutomationHookSlug.make(slugs.replayHook),
			});
			expect(replayRuns).toHaveLength(1);
			const replayRun = requirePresent(replayRuns[0], "Expected replay automation run");
			expect(yield* listAutomationTriggers({ triggerId: replayRun.triggerId })).toHaveLength(1);
			expect(yield* listAutomationRunAttempts({ runId: replayRun.id })).toHaveLength(1);
			const events = yield* listEventsForEntity(client, entity.id, undefined, 20, {
				eventSchemaSlug: slugs.replayEvent,
			});
			expect(events).toHaveLength(1);
		}),
	);
});
