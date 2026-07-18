import { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const triggerFixture = (id = "trigger-test", signalSchemaPluginId: PluginId | null = null) =>
	Schema.decodeSync(AutomationTrigger)({
		id,
		scopeUserId: null,
		blockedReason: null,
		payloadPrunedAt: null,
		createdAt: "2026-09-15T00:00:00.000Z",
		occurredAt: "2026-09-15T00:00:00.000Z",
		kind: { operation: "emit", category: "signal", resource: "signal" },
		payload: {
			operation: "emit",
			category: "signal",
			resource: "signal",
			actorUserId: "owner",
			signalSchemaPluginId,
			signalSchemaSlug: "fixture.signal",
			properties: { nested: { a: 1, b: 2 } },
		},
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			parentTriggerId: null,
			importRunId: "import",
			executionId: "command",
			rootExecutionId: "command",
			integrationId: "integration",
			providerExecutionId: "provider",
			initiator: { id: "owner", kind: "user" },
		},
	});
