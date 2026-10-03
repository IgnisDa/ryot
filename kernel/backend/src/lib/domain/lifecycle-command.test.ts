import type { AutomationTriggerPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	childLifecycleCommand,
	populationLifecycleCommand,
	lifecycleTrigger,
	rootLifecycleCommand,
} from "./lifecycle-command";

describe("lifecycle commands", () => {
	it("keeps nested child identities distinct from provider population path identities", () => {
		const command = rootLifecycleCommand({
			accountGeneration: null,
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
	it("preserves causal metadata and changes trigger identity by resource or item", () => {
		const executionId = AutomationExecutionId.make("execution-1");
		const integrationId = IntegrationId.make("integration-1");
		const occurredAt = "2026-09-15T00:00:00.000Z";
		const scopeUserId = UserId.make("user-1");
		const entityPayload = {
			resource: "entity",
			category: "request",
			operation: "create",
			draft: {
				name: "Item",
				properties: {},
				providerId: null,
				externalId: null,
				populatedAt: null,
				entitySchemaSlug: EntitySchemaSlug.make("item"),
			},
		} satisfies AutomationTriggerPayload;
		const eventPayload = {
			resource: "event",
			category: "request",
			operation: "create",
			draft: {
				occurredAt,
				properties: {},
				sessionEntityId: null,
				entityId: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("item"),
				eventSchemaSlug: EventSchemaSlug.make("progress"),
			},
		} satisfies AutomationTriggerPayload;
		const command = rootLifecycleCommand({
			occurredAt,
			executionId,
			integrationId,
			source: "integration",
			itemIdentity: "item-1",
			importRunId: ImportRunId.make("import-1"),
			initiator: { id: integrationId, kind: "integration" },
			providerExecutionId: AutomationExecutionId.make("provider-1"),
			accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		});

		const trigger = lifecycleTrigger(command, scopeUserId, entityPayload);
		expect(lifecycleTrigger(command, scopeUserId, entityPayload)).toEqual(trigger);
		expect(
			lifecycleTrigger({ ...command, itemIdentity: "item-2" }, scopeUserId, entityPayload).id,
		).not.toBe(trigger.id);
		expect(lifecycleTrigger(command, scopeUserId, eventPayload).id).not.toBe(trigger.id);
		expect(trigger).toMatchObject({
			occurredAt,
			scopeUserId,
			blockedReason: null,
			createdAt: occurredAt,
			payloadPrunedAt: null,
			payload: entityPayload,
			causation: command.causation,
			kind: { resource: "entity", category: "request", operation: "create" },
		});
	});
});
