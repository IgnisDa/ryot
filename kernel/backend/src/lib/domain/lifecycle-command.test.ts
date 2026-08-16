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

import { lifecycleTrigger, rootLifecycleCommand } from "./lifecycle-command";

describe("lifecycle commands", () => {
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
