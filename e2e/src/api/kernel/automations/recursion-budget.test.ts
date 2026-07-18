import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationHookSlug,
	EntitySchemaSlug,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	getApiClient,
	installTestPluginBundle,
	listAutomationRuns,
	listAutomationTriggers,
	listEventsForEntity,
	pollAutomationRuns,
	pollTerminalAutomationRuns,
	pollUntil,
	uninstallTestPlugin,
	waitForEventWithSchema,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

type PluginScript = PluginManifest["scripts"][number];

const automationScript = (
	slug: string,
	name: string,
	capabilities: Extract<PluginScript, { kind: "automation" }>["capabilities"],
): Extract<PluginScript, { kind: "automation" }> => ({
	slug,
	name,
	capabilities,
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	entry: `backend/scripts/${slug}.sandbox.ts`,
});

const sandboxManifest = (script: Extract<PluginScript, { kind: "automation" }>) => {
	const { entry: _entry, ...manifest } = script;
	return manifest;
};

const noOpAutomationSource = (script: Extract<PluginScript, { kind: "automation" }>) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest(${JSON.stringify(sandboxManifest(script))});

export default defineAutomation({
  manifest,
  run: () => Effect.succeed(null),
});
`;

const recursionRootSource = (input: {
	readonly childEventSchemaSlug: string;
	readonly relationshipSchemaSlug: string;
	readonly script: Extract<PluginScript, { kind: "automation" }>;
}) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest(${JSON.stringify(sandboxManifest(input.script))});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const payload = automation.payload;
    if (payload.resource !== "event" || payload.operation !== "create") return null;
    const chainId = payload.after.properties.chainId;
    const targetEntityId = payload.after.properties.targetEntityId;
    if (typeof chainId !== "string" || typeof targetEntityId !== "string") {
      return yield* Effect.fail(new Error("Recursion root properties are invalid"));
    }
    yield* Effect.all([
      host.createEvents([{
        entityId: payload.after.entityId,
        eventSchemaSlug: ${JSON.stringify(input.childEventSchemaSlug)},
        properties: { chainId },
      }]),
      host.changeUserRelationships([{
        deletes: [],
        creates: [{
          properties: { chainId },
          targetEntityId,
          sourceEntityId: payload.after.entityId,
          relationshipSchemaSlug: ${JSON.stringify(input.relationshipSchemaSlug)},
        }],
      }]),
      host.emitSignal({
        schemaSlug: "integration.disabled",
        discriminator: chainId + "-depth-1",
        properties: { integrationId: chainId, providerName: "recursion-budget" },
      }),
    ], { concurrency: "unbounded" });
    return null;
  }),
});
`;

const recursiveSignalSource = (script: Extract<PluginScript, { kind: "automation" }>) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest(${JSON.stringify(sandboxManifest(script))});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const payload = automation.payload;
    if (payload.resource !== "signal") return null;
    const chainId = payload.properties.integrationId;
    if (typeof chainId !== "string") {
      return yield* Effect.fail(new Error("Recursive signal integrationId is invalid"));
    }
    const depth = automation.causation.depth + 1;
    yield* host.emitSignal({
      schemaSlug: "integration.disabled",
      discriminator: chainId + "-depth-" + depth,
      properties: { integrationId: chainId, providerName: "recursion-budget" },
    });
    return null;
  }),
});
`;

const fanoutRootSource = (input: {
	readonly childEventSchemaSlug: string;
	readonly script: Extract<PluginScript, { kind: "automation" }>;
}) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest(${JSON.stringify(sandboxManifest(input.script))});

export default defineAutomation({
  manifest,
  run: ({ automation }, host) => Effect.gen(function* () {
    const payload = automation.payload;
    if (payload.resource !== "event" || payload.operation !== "create") return null;
    yield* Effect.all(["left", "right"].map((branch) => host.createEvents([{
      entityId: payload.after.entityId,
      eventSchemaSlug: ${JSON.stringify(input.childEventSchemaSlug)},
      properties: { branch },
    }])), { concurrency: "unbounded" });
    return null;
  }),
});
`;

const schemaFields = (
	fields: PluginManifest["entitySchemas"][number]["propertiesSchema"]["fields"],
) => ({ fields, unknownKeys: "strict" as const });

const reconcilePluginInstallations = () =>
	getApiClient().call(
		(client) => client.testSupport.reconcilePluginInstallations(),
		adminHeaders(),
	);

describe("automation recursion budgets", () => {
	it.live("preserves parentage through replay and blocks descendants beyond depth eight", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const pluginSlug = `e2e-recursion-${suffix}`;
			const entitySchemaSlug = EntitySchemaSlug.make(`recursion-entity-${suffix}`);
			const seedEventSchemaSlug = EventSchemaSlug.make(`recursion-seed-${suffix}`);
			const childEventSchemaSlug = EventSchemaSlug.make(`recursion-child-${suffix}`);
			const relationshipSchemaSlug = `recursion-relationship-${suffix}`;
			const rootHookSlug = AutomationHookSlug.make(`recursion-root-${suffix}`);
			const recursiveHookSlug = AutomationHookSlug.make(`recursion-signal-${suffix}`);
			const rootScript = automationScript(rootHookSlug, "E2E recursion root", [
				"createEvents",
				"changeUserRelationships",
				"emitSignal",
			]);
			const recursiveScript = automationScript(recursiveHookSlug, "E2E recursive signal", [
				"emitSignal",
			]);
			const plugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					pluginSlug,
					scope: "system",
					scripts: [rootScript, recursiveScript],
					files: {
						[recursiveScript.entry]: recursiveSignalSource(recursiveScript),
						[rootScript.entry]: recursionRootSource({
							script: rootScript,
							childEventSchemaSlug,
							relationshipSchemaSlug,
						}),
					},
					relationshipSchemas: [
						{
							slug: relationshipSchemaSlug,
							name: "E2E recursion relationship",
							sourceEntitySchemaSlug: entitySchemaSlug,
							targetEntitySchemaSlug: entitySchemaSlug,
							propertiesSchema: schemaFields({
								chainId: {
									type: "string",
									label: "Chain ID",
									validation: { required: true },
									description: "Unique recursion chain ID",
								},
							}),
						},
					],
					hooks: [
						{
							stage: "after",
							delivery: "async",
							slug: rootHookSlug,
							causationSources: ["api"],
							scriptSlug: rootScript.slug,
							name: "E2E recursion root hook",
							targets: [
								{
									entitySchemaSlug,
									resource: "event",
									operation: "create",
									eventSchemaSlug: seedEventSchemaSlug,
								},
							],
						},
						{
							stage: "after",
							delivery: "async",
							slug: recursiveHookSlug,
							scriptSlug: recursiveScript.slug,
							causationSources: ["automation"],
							name: "E2E recursive signal hook",
							targets: [
								{ operation: "emit", resource: "signal", signalSchemaSlug: "integration.disabled" },
							],
						},
					],
					entitySchemas: [
						{
							icon: "network",
							slug: entitySchemaSlug,
							name: "E2E recursion entity",
							propertiesSchema: schemaFields({}),
							eventSchemas: [
								{
									slug: seedEventSchemaSlug,
									name: "E2E recursion seed",
									propertiesSchema: schemaFields({
										chainId: {
											type: "string",
											label: "Chain ID",
											validation: { required: true },
											description: "Unique recursion chain ID",
										},
										targetEntityId: {
											type: "string",
											label: "Target entity ID",
											validation: { required: true },
											description: "Relationship target entity ID",
										},
									}),
								},
								{
									slug: childEventSchemaSlug,
									name: "E2E recursion child",
									propertiesSchema: schemaFields({
										chainId: {
											type: "string",
											label: "Chain ID",
											validation: { required: true },
											description: "Unique recursion chain ID",
										},
									}),
								},
							],
						},
					],
				}),
				uninstallTestPlugin,
			);
			yield* reconcilePluginInstallations();

			const source = yield* createEntity(client, {
				properties: {},
				entitySchemaSlug,
				name: "Recursion source",
			});
			const target = yield* createEntity(client, {
				properties: {},
				entitySchemaSlug,
				name: "Recursion target",
			});
			const chainId = `chain-${crypto.randomUUID()}`;
			expect(
				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: source.id,
								eventSchemaSlug: seedEventSchemaSlug,
								properties: { chainId, targetEntityId: target.id },
							},
						],
					}),
				),
			).toMatchObject({ count: 1 });

			const seedEvent = yield* waitForEventWithSchema(client, source.id, seedEventSchemaSlug);
			const [rootRun] = yield* pollAutomationRuns({
				hookSlug: rootHookSlug,
				executionUserId: UserId.make(userId),
				sourceRecord: { id: seedEvent.id, resource: "event" },
			});
			const root = requirePresent(rootRun, "Expected recursion root automation run");
			const rootTrigger = requirePresent(
				(yield* listAutomationTriggers({ triggerId: root.triggerId }))[0],
				"Expected recursion root trigger",
			);
			const rootExecutionId = rootTrigger.causation.rootExecutionId;
			yield* pollUntil(
				"depth-nine blocked automation trigger",
				listAutomationTriggers({ rootExecutionId }).pipe(
					Effect.map(
						(triggers) =>
							triggers.find(
								(trigger) => trigger.causation.depth === 9 && trigger.blockedReason !== null,
							) ?? null,
					),
				),
			);
			yield* pollTerminalAutomationRuns({ rootExecutionId });

			const triggers = yield* listAutomationTriggers({ rootExecutionId });
			const depthOneChanges = triggers.filter(
				(trigger) => trigger.causation.depth === 1 && trigger.payload?.category === "change",
			);
			const childEventTriggers = depthOneChanges.filter(
				(trigger) =>
					trigger.payload?.category === "change" &&
					trigger.payload.resource === "event" &&
					trigger.payload.operation === "create" &&
					trigger.payload.after.eventSchemaSlug === childEventSchemaSlug,
			);
			const relationshipTriggers = depthOneChanges.filter(
				(trigger) =>
					trigger.payload?.category === "change" &&
					trigger.payload.resource === "relationship" &&
					trigger.payload.operation === "create" &&
					trigger.payload.after.relationshipSchemaSlug === relationshipSchemaSlug,
			);
			const signalTriggers = triggers
				.filter(
					(trigger) =>
						trigger.payload?.category === "signal" &&
						trigger.payload.properties.integrationId === chainId,
				)
				.sort((left, right) => left.causation.depth - right.causation.depth);

			expect(childEventTriggers).toHaveLength(1);
			expect(relationshipTriggers).toHaveLength(1);
			expect(signalTriggers.map(({ causation }) => causation.depth)).toEqual([
				1, 2, 3, 4, 5, 6, 7, 8, 9,
			]);
			for (const trigger of [childEventTriggers[0], relationshipTriggers[0]]) {
				const changeTrigger = requirePresent(trigger, "Expected depth-one change trigger");
				const requestTrigger = requirePresent(
					triggers.find(({ id }) => id === changeTrigger.causation.parentTriggerId),
					"Expected parent request trigger",
				);
				expect(changeTrigger.causation).toMatchObject({
					depth: 1,
					rootExecutionId,
					parentRunId: root.id,
					source: "automation",
					parentTriggerId: requestTrigger.id,
				});
				expect(requestTrigger.payload).toMatchObject({ category: "request" });
				expect(requestTrigger.causation).toMatchObject({
					depth: 1,
					rootExecutionId,
					parentRunId: root.id,
					source: "automation",
					parentTriggerId: root.triggerId,
				});
			}
			expect(signalTriggers[0]?.causation).toMatchObject({
				depth: 1,
				rootExecutionId,
				parentRunId: root.id,
				source: "automation",
				parentTriggerId: root.triggerId,
			});

			const recursiveRuns = yield* listAutomationRuns({
				rootExecutionId,
				hookSlug: recursiveHookSlug,
				executionUserId: UserId.make(userId),
			});
			expect(recursiveRuns).toHaveLength(8);
			expect(recursiveRuns.every(({ status }) => status === "succeeded")).toBe(true);
			const recursiveRunByTrigger = new Map(recursiveRuns.map((run) => [run.triggerId, run]));
			for (let index = 1; index < signalTriggers.length; index += 1) {
				const previous = requirePresent(
					signalTriggers[index - 1],
					"Expected previous signal trigger",
				);
				const current = requirePresent(signalTriggers[index], "Expected current signal trigger");
				const parentRun = requirePresent(
					recursiveRunByTrigger.get(previous.id),
					"Expected recursive parent run",
				);
				expect(current.causation).toMatchObject({
					rootExecutionId,
					source: "automation",
					parentRunId: parentRun.id,
					parentTriggerId: previous.id,
				});
			}

			const blocked = requirePresent(signalTriggers[8], "Expected blocked depth-nine trigger");
			expect(blocked.blockedReason).toMatchObject({
				hasRequiredHooks: false,
				code: "automation-limit-reached",
			});
			expect(blocked.blockedReason?.omittedHooks).toEqual(
				expect.arrayContaining([{ pluginId: plugin.pluginId, hookSlug: recursiveHookSlug }]),
			);
			expect(yield* listAutomationRuns({ triggerId: blocked.id })).toEqual([]);

			const childEvents = (yield* listEventsForEntity(client, source.id, undefined, 100)).filter(
				(event) =>
					event.eventSchemaSlug === childEventSchemaSlug && event.properties.chainId === chainId,
			);
			expect(childEvents).toHaveLength(1);
		}),
	);

	it.live("shares the root run budget across concurrent child fan-out", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const pluginSlug = `e2e-fanout-${suffix}`;
			const entitySchemaSlug = EntitySchemaSlug.make(`fanout-entity-${suffix}`);
			const seedEventSchemaSlug = EventSchemaSlug.make(`fanout-seed-${suffix}`);
			const childEventSchemaSlug = EventSchemaSlug.make(`fanout-child-${suffix}`);
			const rootHookSlug = AutomationHookSlug.make(`fanout-root-${suffix}`);
			const noOpScriptSlug = `fanout-noop-${suffix}`;
			const rootScript = automationScript(rootHookSlug, "E2E fanout root", ["createEvents"]);
			const noOpScript = automationScript(noOpScriptSlug, "E2E fanout no-op", []);
			const fanoutHookSlugs = Array.from(
				{ length: 51 },
				(_, index) => `fanout-child-${index}-${suffix}`,
			);
			const hooks: PluginManifest["hooks"] = [
				{
					stage: "after",
					delivery: "async",
					slug: rootHookSlug,
					causationSources: ["api"],
					scriptSlug: rootScript.slug,
					name: "E2E concurrent fanout root hook",
					targets: [
						{
							entitySchemaSlug,
							resource: "event",
							operation: "create",
							eventSchemaSlug: seedEventSchemaSlug,
						},
					],
				},
				...fanoutHookSlugs.map((hookSlug) => ({
					slug: hookSlug,
					stage: "after" as const,
					delivery: "async" as const,
					scriptSlug: noOpScript.slug,
					name: `E2E fanout child hook ${hookSlug}`,
					causationSources: ["automation" as const],
					targets: [
						{
							entitySchemaSlug,
							resource: "event" as const,
							operation: "create" as const,
							eventSchemaSlug: childEventSchemaSlug,
						},
					],
				})),
			];
			yield* Effect.acquireRelease(
				installTestPluginBundle({
					hooks,
					pluginSlug,
					scope: "system",
					scripts: [rootScript, noOpScript],
					files: {
						[noOpScript.entry]: noOpAutomationSource(noOpScript),
						[rootScript.entry]: fanoutRootSource({ script: rootScript, childEventSchemaSlug }),
					},
					entitySchemas: [
						{
							icon: "git-fork",
							slug: entitySchemaSlug,
							name: "E2E fanout entity",
							propertiesSchema: schemaFields({}),
							eventSchemas: [
								{
									name: "E2E fanout seed",
									slug: seedEventSchemaSlug,
									propertiesSchema: schemaFields({}),
								},
								{
									name: "E2E fanout child",
									slug: childEventSchemaSlug,
									propertiesSchema: schemaFields({
										branch: {
											type: "string",
											label: "Branch",
											validation: { required: true },
											description: "Concurrent fanout branch",
										},
									}),
								},
							],
						},
					],
				}),
				uninstallTestPlugin,
			);
			yield* reconcilePluginInstallations();

			const entity = yield* createEntity(client, {
				properties: {},
				entitySchemaSlug,
				name: "Fanout entity",
			});
			expect(
				yield* client.call((c) =>
					c.events.create({
						payload: [
							{ properties: {}, entityId: entity.id, eventSchemaSlug: seedEventSchemaSlug },
						],
					}),
				),
			).toMatchObject({ count: 1 });

			const seedEvent = yield* waitForEventWithSchema(client, entity.id, seedEventSchemaSlug);
			const [rootRun] = yield* pollAutomationRuns({
				hookSlug: rootHookSlug,
				executionUserId: UserId.make(userId),
				sourceRecord: { id: seedEvent.id, resource: "event" },
			});
			const root = requirePresent(rootRun, "Expected concurrent fanout root run");
			const rootTrigger = requirePresent(
				(yield* listAutomationTriggers({ triggerId: root.triggerId }))[0],
				"Expected concurrent fanout root trigger",
			);
			const rootExecutionId = rootTrigger.causation.rootExecutionId;
			yield* pollUntil(
				"concurrent fanout budget decision",
				listAutomationTriggers({ rootExecutionId }).pipe(
					Effect.map((triggers) => {
						const children = triggers.filter(
							(trigger) =>
								trigger.causation.depth === 1 &&
								trigger.payload?.category === "change" &&
								trigger.payload.resource === "event" &&
								trigger.payload.operation === "create" &&
								trigger.payload.after.eventSchemaSlug === childEventSchemaSlug,
						);
						return children.length === 2 &&
							children.some(({ blockedReason }) => blockedReason !== null)
							? children
							: null;
					}),
				),
			);
			yield* pollTerminalAutomationRuns({ rootExecutionId });

			const triggers = yield* listAutomationTriggers({ rootExecutionId });
			const childTriggers = triggers.filter(
				(trigger) =>
					trigger.causation.depth === 1 &&
					trigger.payload?.category === "change" &&
					trigger.payload.resource === "event" &&
					trigger.payload.operation === "create" &&
					trigger.payload.after.eventSchemaSlug === childEventSchemaSlug,
			);
			expect(childTriggers).toHaveLength(2);
			for (const trigger of childTriggers) {
				const requestTrigger = requirePresent(
					triggers.find(({ id }) => id === trigger.causation.parentTriggerId),
					"Expected concurrent child parent request trigger",
				);
				expect(trigger.causation).toMatchObject({
					rootExecutionId,
					parentRunId: root.id,
					source: "automation",
					parentTriggerId: requestTrigger.id,
				});
				expect(requestTrigger.payload).toMatchObject({ category: "request" });
				expect(requestTrigger.causation).toMatchObject({
					rootExecutionId,
					parentRunId: root.id,
					source: "automation",
					parentTriggerId: root.triggerId,
				});
			}
			const blocked = requirePresent(
				childTriggers.find(({ blockedReason }) => blockedReason !== null),
				"Expected one blocked concurrent fanout trigger",
			);
			const accepted = requirePresent(
				childTriggers.find(({ blockedReason }) => blockedReason === null),
				"Expected one accepted concurrent fanout trigger",
			);
			expect(blocked.blockedReason).toMatchObject({
				hasRequiredHooks: false,
				code: "automation-limit-reached",
			});
			expect(blocked.blockedReason?.omittedHooks).toHaveLength(51);
			expect(yield* listAutomationRuns({ triggerId: blocked.id })).toEqual([]);
			expect(yield* listAutomationRuns({ triggerId: accepted.id })).toHaveLength(51);

			const rootRuns = yield* listAutomationRuns({ rootExecutionId });
			expect(rootRuns).toHaveLength(52);
			expect(rootRuns.filter(({ hookSlug }) => fanoutHookSlugs.includes(hookSlug))).toHaveLength(
				51,
			);
			expect(rootRuns.every(({ status }) => status === "succeeded")).toBe(true);
			const childEvents = (yield* listEventsForEntity(client, entity.id, undefined, 100)).filter(
				(event) => event.eventSchemaSlug === childEventSchemaSlug,
			);
			expect(
				childEvents
					.map(({ properties }) => {
						if (typeof properties.branch !== "string") {
							throw new Error("Expected a string fanout branch");
						}
						return properties.branch;
					})
					.sort((left, right) => left.localeCompare(right)),
			).toEqual(["left", "right"]);
		}),
	);
});
