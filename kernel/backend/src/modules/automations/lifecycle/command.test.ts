import { describe, expect } from "bun:test";

import type { AutomationTriggerPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import {
	automationLifecycleCausation,
	childLifecycleCommand,
	lifecycleTrigger,
	populationLifecycleCommand,
	rootLifecycleCommand,
} from "./command";

const write = (lane: "background" | "interactive") => {
	const { causation } = rootLifecycleCommand({
		lane,
		source: "api",
		accountUserId: null,
		itemIdentity: "entity",
		occurredAt: "2026-09-15T00:00:00.000Z",
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make("root"),
	});
	return automationLifecycleCausation(
		{
			causation,
			runId: AutomationRunId.make("after-run"),
			triggerId: AutomationTriggerId.make("trigger"),
		},
		AutomationExecutionId.make("after-write"),
	).lane;
};

describe("lifecycle commands", () => {
	it("keeps nested child identities distinct from provider population path identities", () => {
		const command = rootLifecycleCommand({
			lane: "background",
			accountUserId: null,
			source: "provider-refresh",
			itemIdentity: '["import",2]',
			occurredAt: "2026-09-15T00:00:00.000Z",
			initiator: { id: null, kind: "system" },
			executionId: AutomationExecutionId.make("provider-identity"),
		});
		const population = {
			rootPreviouslyPopulated: false,
			scopeEntity: {
				name: "Root",
				id: EntityId.make("root"),
				entitySchemaPluginId: null,
				entitySchemaSlug: EntitySchemaSlug.make("item"),
			},
		};
		const child = childLifecycleCommand(command, '["root","upsert"]');
		const provider = populationLifecycleCommand(command, ["root", "upsert"], population);
		expect(child.itemIdentity).toBe('["[\\"import\\",2]","[\\"root\\",\\"upsert\\"]"]');
		expect(provider.itemIdentity).toBe('["[\\"import\\",2]","root","upsert"]');
		expect(child.causation).toBe(command.causation);
		expect(provider.causation).toBe(command.causation);
		expect(provider.population).toBe(population);
	});
	it("scheduling_lane_survives_durable_boundaries: after hook writes run in the background lane", () => {
		expect(write("interactive")).toBe("background");
		expect(write("background")).toBe("background");
	});
	it.effect(
		"preserves causal metadata and changes trigger identity by resource or item",
		() =>
			Effect.gen(function* () {
				const executionId = AutomationExecutionId.make("execution-1");
				const integrationId = IntegrationId.make("integration-1");
				const occurredAt = "2026-09-15T00:00:00.000Z";
				const scopeUserId = UserId.make("user-1");
				const entityPayload = {
					resource: "entity",
					category: "change",
					operation: "create",
					after: {
						name: "Item",
						properties: {},
						providerId: null,
						externalId: null,
						populatedAt: null,
						createdAt: occurredAt,
						updatedAt: occurredAt,
						entitySchemaPluginId: null,
						id: EntityId.make("entity-1"),
						entitySchemaSlug: EntitySchemaSlug.make("item"),
					},
				} satisfies AutomationTriggerPayload;
				const eventPayload = {
					resource: "event",
					category: "change",
					operation: "create",
					after: {
						occurredAt,
						properties: {},
						createdAt: occurredAt,
						updatedAt: occurredAt,
						sessionEntityId: null,
						eventSchemaPluginId: null,
						entitySchemaPluginId: null,
						id: EventId.make("event-1"),
						entityId: EntityId.make("entity-1"),
						entitySchemaSlug: EntitySchemaSlug.make("item"),
						eventSchemaSlug: EventSchemaSlug.make("progress"),
					},
				} satisfies AutomationTriggerPayload;
				const command = rootLifecycleCommand({
					occurredAt,
					executionId,
					integrationId,
					lane: "background",
					source: "integration",
					itemIdentity: "item-1",
					accountUserId: UserId.make("user-1"),
					importRunId: ImportRunId.make("import-1"),
					initiator: { id: integrationId, kind: "integration" },
					providerExecutionId: AutomationExecutionId.make("provider-1"),
				});

				const trigger = yield* lifecycleTrigger(command, scopeUserId, entityPayload);
				expect(yield* lifecycleTrigger(command, scopeUserId, entityPayload)).toEqual(trigger);
				expect(
					(yield* lifecycleTrigger(
						{ ...command, itemIdentity: "item-2" },
						scopeUserId,
						entityPayload,
					)).id,
				).not.toBe(trigger.id);
				expect((yield* lifecycleTrigger(command, scopeUserId, eventPayload)).id).not.toBe(
					trigger.id,
				);
				expect(trigger).toMatchObject({
					occurredAt,
					scopeUserId,
					blockedReason: null,
					createdAt: occurredAt,
					payloadPrunedAt: null,
					payload: entityPayload,
					causation: command.causation,
					kind: { resource: "entity", category: "change", operation: "create" },
				});
			}),
		testTimeout,
	);
});
