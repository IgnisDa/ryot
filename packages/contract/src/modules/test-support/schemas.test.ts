import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	TestSupportListAutomationRunAttemptsBody,
	TestSupportListAutomationRunsBody,
	TestSupportListAutomationTriggerRecipientsBody,
	TestSupportListAutomationTriggersBody,
	TestSupportSystemPlugin,
} from "./schemas";

const signalPayload = {
	operation: "emit",
	category: "signal",
	resource: "signal",
	actorUserId: "owner",
	properties: { value: 1 },
	signalSchemaPluginId: "plugin-1",
	signalSchemaSlug: "fixture.signal",
} as const;

describe("test-support automation inspection schemas", () => {
	it("accepts exact trigger and run polling filters", () => {
		expect(
			Schema.decodeUnknownSync(TestSupportListAutomationTriggersBody)({
				payload: signalPayload,
				triggerId: "trigger-1",
				rootExecutionId: "root-1",
				sourceRecord: { id: "entity-1", resource: "entity" },
			}),
		).toEqual({
			payload: signalPayload,
			triggerId: "trigger-1",
			rootExecutionId: "root-1",
			sourceRecord: { id: "entity-1", resource: "entity" },
		});
		expect(
			Schema.decodeUnknownSync(TestSupportListAutomationRunsBody)({
				status: "failed",
				executionUserId: null,
				rootExecutionId: "root-1",
				hookSlug: "fixture.notify",
			}),
		).toEqual({
			status: "failed",
			executionUserId: null,
			rootExecutionId: "root-1",
			hookSlug: "fixture.notify",
		});
	});

	it("accepts exact recipient and attempt filters", () => {
		expect(
			Schema.decodeUnknownSync(TestSupportListAutomationTriggerRecipientsBody)({
				userId: "owner",
				triggerId: "trigger-1",
			}),
		).toEqual({ userId: "owner", triggerId: "trigger-1" });
		expect(
			Schema.decodeUnknownSync(TestSupportListAutomationRunAttemptsBody)({
				runId: "run-1",
				status: "succeeded",
			}),
		).toEqual({ runId: "run-1", status: "succeeded" });
	});

	it("rejects removed execution fixture filters and mismatched source records", () => {
		expect(() =>
			Schema.decodeUnknownSync(TestSupportListAutomationTriggersBody)({
				schemaSlug: "fixture.signal",
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(TestSupportListAutomationRunsBody)({
				signalId: "signal-1",
				executionUserId: "owner",
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(TestSupportListAutomationTriggersBody)({
				sourceRecord: { id: "event-1", resource: "signal" },
			}),
		).toThrow();
	});
});

it("decodes persisted plugin operation handles without configuration data", () => {
	const decoded = Schema.decodeUnknownSync(TestSupportSystemPlugin)({
		scope: "user",
		icon: "flask",
		slug: "fixture",
		name: "Fixture",
		version: "2.0.0",
		pluginId: "plugin-1",
		sourceHash: "source-2",
		configRevisionId: "config-2",
		description: "Fixture plugin",
		installationId: "installation-1",
		activePluginRevisionId: "revision-2",
		scripts: [{ id: "script-2", slug: "fixture.run", contentHash: "content-2" }],
	});

	expect(decoded).toMatchObject({
		pluginId: "plugin-1",
		configRevisionId: "config-2",
		installationId: "installation-1",
		activePluginRevisionId: "revision-2",
		scripts: [{ id: "script-2", slug: "fixture.run", contentHash: "content-2" }],
	});
	expect(decoded).not.toHaveProperty("config");
});
