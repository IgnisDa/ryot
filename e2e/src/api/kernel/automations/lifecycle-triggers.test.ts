import type { ContractPayload } from "@ryot-app/contract/client";
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
	type AutomationTrigger,
	type AutomationTriggerFilter,
	type Client,
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	type InstalledTestPlugin,
	installTestPluginBundle,
	listAutomationRuns,
	listAutomationTriggers,
	listEventsForEntity,
	pollTerminalAutomationRunAttempts,
	pollTerminalAutomationRuns,
	postApiJson,
	startDataJsonImport,
	type TestPluginScript,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { manifestText } from "~/fixtures/kernel/manifest-text";
import { requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

type EventInput = CreateEventsPayload[number];
type CreateEventsResult = CreateEventsResponse;
type PluginScript = PluginManifest["scripts"][number];
type CreateEventsPayload = ContractPayload<"events", "create">;
type TriggerPayload = NonNullable<AutomationTrigger["payload"]>;
type FixtureScript = TestPluginScript & { readonly entry: string };
type AutomationScript = Extract<PluginScript, { kind: "automation" }>;
type FixtureAutomationScript = { readonly entry: string } & Extract<
	FixtureScript,
	{ kind: "automation" }
>;
type SourceRecord = Extract<
	NonNullable<AutomationTriggerFilter["sourceRecord"]>,
	{ readonly resource: "event" | "entity" | "relationship" }
>;

const suffix = crypto.randomUUID();
const slugs = {
	plugin: `e2e-lifecycle-${suffix}`,
	entity: `lifecycle-entity-${suffix}`,
	asyncEvent: `lifecycle-async-${suffix}`,
	policyEvent: `lifecycle-policy-${suffix}`,
	asyncHook: `lifecycle-async-hook-${suffix}`,
	slowScript: `lifecycle-slow-script-${suffix}`,
	policyHook: `lifecycle-policy-hook-${suffix}`,
	entityHook: `lifecycle-entity-hook-${suffix}`,
	relationship: `lifecycle-relationship-${suffix}`,
	policyScript: `lifecycle-policy-script-${suffix}`,
	successScript: `lifecycle-success-script-${suffix}`,
	policyAfterHook: `lifecycle-policy-after-${suffix}`,
	relationshipHook: `lifecycle-relationship-hook-${suffix}`,
} as const;

const entries = {
	slow: "backend/automations/lifecycle-slow.sandbox.ts",
	policy: "backend/automations/lifecycle-policy.sandbox.ts",
	success: "backend/automations/lifecycle-success.sandbox.ts",
} as const;

type AutomationDeclaration =
	| Pick<
			Extract<AutomationScript, { automationType: "policy" }>,
			"automationType" | "inputProjection"
	  >
	| Pick<
			Extract<AutomationScript, { automationType: "automation" }>,
			"automationType" | "inputProjection"
	  >;

const automationScript = (
	slug: string,
	entry: string,
	name: string,
	declaration: AutomationDeclaration,
): FixtureAutomationScript => ({
	slug,
	name,
	entry,
	...declaration,
	capabilities: [],
	kind: "automation",
	oauthConnectionFields: [],
	executableDependencies: [],
	requiredPluginConfigKeys: [],
	optionalPluginConfigKeys: [],
});

const policySource = `
import {
  defineAutomationPolicy,
  type AutomationPolicyInput,
  type AutomationPolicyResult,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "policy",
  slug: ${JSON.stringify(slugs.policyScript)},
  name: "E2E lifecycle policy",
  inputProjection: { event: { properties: ["marker"] } },
});

const decide = Effect.fn(function* (automation: AutomationPolicyInput["automation"]): Effect.fn.Return<AutomationPolicyResult, Error> {
  const payload = automation.payload;
  if (payload.resource !== "event" || payload.operation !== "create") {
    return { action: "allow" };
  }
  const marker = payload.draft.properties.marker;
  if (marker === "reject") {
    return { action: "reject", reason: { key: "e2e.fixture-policy-rejection" } };
  }
  if (marker === "fail") {
    return yield* Effect.fail(new Error("fixture policy execution failure"));
  }
  if (marker === "transform") {
    return {
      action: "transform",
      patch: {
        resource: "event",
        draft: { properties: { set: { marker: "transformed" }, remove: [] } },
      },
    };
  }
  return { action: "allow" };
});

export default defineAutomationPolicy({
  manifest,
  run: ({ automation, items }) => Effect.forEach(items, ({ itemIdentity, payload }) => Effect.gen(function* () {
    return { itemIdentity, decision: yield* decide({ ...automation, payload }) };
  })).pipe(Effect.map((items) => ({ items }))),
});
`;

const afterSource = (input: {
	readonly name: string;
	readonly slug: string;
	readonly body: string;
}) => `
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
  kind: "automation",
  automationType: "automation",
  slug: ${JSON.stringify(input.slug)},
  name: ${JSON.stringify(input.name)},
  inputProjection: {
    entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
    event: { properties: [], compareProperties: [] },
    relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
  },
});

export default defineAutomation({
  manifest,
  run: () => ${input.body},
});
`;

const markerSchema = {
	unknownKeys: "strict" as const,
	fields: {
		marker: {
			type: "string" as const,
			label: manifestText("Marker"),
			description: "E2E lifecycle marker",
			validation: { required: true as const },
		},
	},
};

const policyInputProjection = { event: { properties: ["marker"] } } satisfies Extract<
	AutomationScript,
	{ automationType: "policy" }
>["inputProjection"];
const afterInputProjection = {
	event: { properties: [], compareProperties: [] },
	entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
} satisfies Extract<AutomationScript, { automationType: "automation" }>["inputProjection"];

const eventSchema = (slug: string, name: string) => ({
	slug,
	name: manifestText(name),
	propertiesSchema: markerSchema,
});

const scripts = [
	automationScript(slugs.policyScript, entries.policy, "E2E lifecycle policy", {
		automationType: "policy",
		inputProjection: policyInputProjection,
	}),
	automationScript(slugs.successScript, entries.success, "E2E lifecycle success", {
		automationType: "automation",
		inputProjection: afterInputProjection,
	}),
	automationScript(slugs.slowScript, entries.slow, "E2E lifecycle slow hook", {
		automationType: "automation",
		inputProjection: afterInputProjection,
	}),
] satisfies ReadonlyArray<FixtureScript>;

const installLifecyclePlugin = () =>
	installTestPluginBundle({
		scripts,
		scope: "system",
		pluginSlug: slugs.plugin,
		relationshipSchemas: [
			{
				slug: slugs.relationship,
				propertiesSchema: markerSchema,
				sourceEntitySchemaSlug: slugs.entity,
				targetEntitySchemaSlug: slugs.entity,
				name: manifestText("E2E Lifecycle Relationship"),
			},
		],
		entitySchemas: [
			{
				icon: "box",
				slug: slugs.entity,
				propertiesSchema: markerSchema,
				name: manifestText("E2E Lifecycle Entity"),
				eventSchemas: [
					eventSchema(slugs.policyEvent, "Policy event"),
					eventSchema(slugs.asyncEvent, "Async event"),
				],
			},
		],
		files: {
			[entries.policy]: policySource,
			[entries.success]: afterSource({
				slug: slugs.successScript,
				body: "Effect.succeed({})",
				name: "E2E lifecycle success",
			}),
			[entries.slow]: afterSource({
				slug: slugs.slowScript,
				name: "E2E lifecycle slow hook",
				body: "Effect.sleep(6000).pipe(Effect.as({}))",
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
				slug: slugs.entityHook,
				scriptSlug: slugs.successScript,
				name: "E2E entity snapshot hook",
				targets: [{ resource: "entity", operation: "create", entitySchemaSlug: slugs.entity }],
			},
			{
				stage: "after",
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
		],
	});

const createFixtureEntity = (client: Client, marker: string = crypto.randomUUID()) =>
	createEntity(client, {
		properties: { marker },
		name: `Lifecycle ${marker}`,
		entitySchema: {
			slug: EntitySchemaSlug.make(slugs.entity),
			owner: {
				kind: "plugin" as const,
				pluginId: requirePresent(installed, "Lifecycle plugin is not installed").pluginId,
			},
		},
	});

const lifecyclePluginId = () =>
	requirePresent(installed, "Lifecycle plugin is not installed").pluginId;

const eventInput = (
	entityId: EventInput["entityId"],
	eventSchemaSlug: string,
	marker: string,
	occurredAt: string,
) =>
	({
		entityId,
		occurredAt,
		properties: { marker },
		eventSchemaSlug: EventSchemaSlug.make(eventSchemaSlug),
	}) satisfies EventInput;

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
	Category extends "change" | "request",
	Resource extends "event" | "entity" | "relationship",
>(
	trigger: AutomationTrigger,
	category: Category,
	resource: Resource,
): Extract<
	TriggerPayload,
	{ readonly category: Category; readonly resource: Resource; readonly operation: "create" }
>;
function requireCreatePayload(
	trigger: AutomationTrigger,
	category: "change" | "request",
	resource: "event" | "entity" | "relationship",
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

		const runs = yield* listAutomationRuns({
			triggerId: change.id,
			hookSlug: AutomationHookSlug.make(hookSlug),
		});
		expect(runs).toHaveLength(1);
		return { change, run: requirePresent(runs[0], "Expected an atomic matching run") };
	});

let installed: undefined | InstalledTestPlugin;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			installed = yield* installLifecyclePlugin();
		}),
	),
);

afterAll(() => installed && runPromise(uninstallTestPlugin(installed)));

describe("automation lifecycle triggers", () => {
	it.live("applies normal event policies and after hooks to native data imports", () =>
		Effect.gen(function* () {
			const user = yield* createAuthenticatedClient();
			const entity = yield* createFixtureEntity(user.client, "native-policy-source");
			const importEvents = (markers: ReadonlyArray<string>) =>
				startDataJsonImport(user, {
					relationships: [],
					events: markers.map((marker, index) => ({
						key: marker,
						entityKey: "entity",
						properties: { marker },
						eventSchemaSlug: slugs.policyEvent,
						occurredAt: `2026-10-01T00:0${index}:00.000Z`,
					})),
					entities: [
						{
							key: "entity",
							kind: "existing",
							entityId: entity.id,
							entitySchema: {
								slug: EntitySchemaSlug.make(slugs.entity),
								owner: { kind: "plugin" as const, pluginId: lifecyclePluginId() },
							},
						},
					],
				});
			const entities = {
				unit: "entities",
				recordKind: "entity",
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 1, unsuccessful: 0 },
			};
			const { run, runId } = yield* importEvents(["transform", "reject"]);
			expect(run.status).toBe("completed");
			expect(run.summary).toEqual([
				entities,
				{
					unit: "events",
					recordKind: "event",
					counts: { created: 1, updated: 0, skipped: 1, unchanged: 0, unsuccessful: 0 },
				},
			]);
			const failed = yield* importEvents(["allow", "fail"]);
			expect(failed.run.status).toBe("completed");
			expect(failed.run.summary).toEqual([
				entities,
				{
					unit: "events",
					recordKind: "event",
					counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 2 },
				},
			]);
			const events = yield* listEventsForEntity(user.client, entity.id, undefined, 100);
			expect(events).toHaveLength(1);
			const event = requirePresent(events[0], "Expected the policy-transformed event");
			expect(event.properties).toEqual({ marker: "transformed" });
			const committed = yield* inspectCommittedCreate(
				{ id: event.id, resource: "event" },
				slugs.policyAfterHook,
			);
			expect(committed.change.causation).toMatchObject({ source: "import", importRunId: runId });
			expect(requireCreatePayload(committed.change, "change", "event").after).toMatchObject({
				id: event.id,
				properties: { marker: "transformed" },
			});
		}),
	);

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
			const acceptedResult = yield* createEvents(client, [allowed, transformedInput]);
			expect(acceptedResult).toMatchObject({
				count: 2,
				failure: null,
				outcomes: [
					{ index: 0, status: "written" },
					{ index: 1, status: "written" },
				],
			});

			const acceptedId = requireWrittenEventId(acceptedResult, 0);
			const transformedId = requireWrittenEventId(acceptedResult, 1);
			yield* inspectCommittedCreate({ id: acceptedId, resource: "event" }, slugs.policyAfterHook);
			const transformed = yield* inspectCommittedCreate(
				{ resource: "event", id: transformedId },
				slugs.policyAfterHook,
			);
			const transformedChange = requireCreatePayload(transformed.change, "change", "event");
			expect(transformedChange.after).toMatchObject({
				id: transformedId,
				entityId: entity.id,
				properties: { marker: "transformed" },
				eventSchemaPluginId: lifecyclePluginId(),
				entitySchemaPluginId: lifecyclePluginId(),
				entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				eventSchemaSlug: EventSchemaSlug.make(slugs.policyEvent),
			});

			const rejectedResult = yield* createEvents(client, [rejected]);
			expect(rejectedResult).toMatchObject({
				count: 0,
				failure: null,
				outcomes: [
					{
						index: 0,
						status: "skipped_by_policy",
						reason: { namespace: lifecyclePluginId(), key: "e2e.fixture-policy-rejection" },
					},
				],
			});
			const failedResult = yield* createEvents(client, [failed]);
			expect(failedResult).toMatchObject({
				count: 0,
				failure: { index: 0, reason: { code: "policy-execution-failed" } },
				outcomes: [{ index: 0, status: "failed", reason: { code: "policy-execution-failed" } }],
			});
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
			expect(entityInspection.change.causation.parentTriggerId).toBeNull();
			expect(
				(yield* listAutomationTriggers({
					rootExecutionId: entityInspection.change.causation.rootExecutionId,
				})).filter(({ kind }) => kind.category === "request"),
			).toEqual([]);
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
					entitySchemaPluginId: lifecyclePluginId(),
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
			const eventChange = requireCreatePayload(eventInspection.change, "change", "event");
			const { createdAt, updatedAt, ...eventSnapshot } = eventChange.after;
			expect(eventSnapshot).toEqual({
				id: eventId,
				entityId: source.id,
				sessionEntityId: null,
				occurredAt: event.occurredAt,
				properties: { marker: "snapshot-event" },
				eventSchemaPluginId: lifecyclePluginId(),
				entitySchemaPluginId: lifecyclePluginId(),
				entitySchemaSlug: EntitySchemaSlug.make(slugs.entity),
				eventSchemaSlug: EventSchemaSlug.make(slugs.policyEvent),
			});
			expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(updatedAt).toBe(createdAt);

			const relationship = yield* createRelationship(client, {
				sourceEntityId: source.id,
				targetEntityId: target.id,
				properties: { marker: "snapshot-relationship" },
				relationshipSchema: {
					slug: RelationshipSchemaSlug.make(slugs.relationship),
					owner: { kind: "plugin" as const, pluginId: lifecyclePluginId() },
				},
			});
			const relationshipInspection = yield* inspectCommittedCreate(
				{ id: relationship.id, resource: "relationship" },
				slugs.relationshipHook,
			);
			expect(relationshipInspection.change.causation.parentTriggerId).toBeNull();
			expect(
				(yield* listAutomationTriggers({
					rootExecutionId: relationshipInspection.change.causation.rootExecutionId,
				})).filter(({ kind }) => kind.category === "request"),
			).toEqual([]);
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
					relationshipSchemaPluginId: lifecyclePluginId(),
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
			const response = yield* postApiJson(client, "/events", [item], token);
			expect(response.status).toBe(201);
			const rawResult = yield* Schema.decodeUnknownEffect(CreateEventsResponse)(
				yield* Effect.promise(() => response.json()),
			);

			for (const result of [contractResult, rawResult]) {
				expect(result).toMatchObject({
					count: 1,
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
			expect(rawInspection.run).toMatchObject({ hookSlug: contractInspection.run.hookSlug });
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
			expect(["queued", "running"]).toContain<unknown>(immediateRuns[0]?.status);
			expect(elapsedMs).toBeLessThan(5_000);
			const terminalRuns = yield* pollTerminalAutomationRuns({ triggerId: trigger.id });
			expect(terminalRuns).toMatchObject([{ status: "succeeded" }]);
			const run = requirePresent(terminalRuns[0], "Expected terminal async run");
			expect(yield* pollTerminalAutomationRunAttempts({ runId: run.id })).toHaveLength(1);
		}),
	);
});
