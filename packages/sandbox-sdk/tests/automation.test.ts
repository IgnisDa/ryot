import {
	automationInputSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
	automationResultSchema,
	defineAutomation,
	defineAutomationPolicy,
} from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, test } from "vitest";

import { sandboxManifestSchema } from "../src/core";
import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	name: "Test automation",
	slug: "test-automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	inputProjection: {
		event: {
			properties: ["progress"],
			compareProperties: [{ equality: "json", property: "progress" }],
		},
	},
});
const run = () => Effect.succeed(null);
const policyRun = () => Effect.succeed({ action: "allow" as const });

describe("automation definitions", () => {
	test("rejects unsafe policy manifests at the SDK boundary", () => {
		for (const capability of [
			"httpCall",
			"createEvents",
			"emitSignal",
			"sendNotification",
			"setCachedValue",
			"claimPersistentValue",
			"scratch",
		]) {
			expect(() =>
				Schema.decodeUnknownSync(sandboxManifestSchema)({
					...manifest,
					automationType: "policy",
					capabilities: [capability],
					inputProjection: { event: { properties: ["progress"] } },
				}),
			).toThrow();
		}
	});

	test("separates request policies from committed-change invocations", () => {
		const context = {
			runId: "run-1",
			triggerId: "trigger-1",
			hookSlug: "test.policy",
			executionUserId: "user-1",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "command-1",
				rootExecutionId: "command-1",
				initiator: { kind: "user", id: "user-1" },
			},
		};
		const request = {
			...context,
			payload: {
				resource: "event",
				category: "request",
				operation: "create",
				draft: {
					properties: {},
					entityId: "entity-1",
					sessionEntityId: null,
					entitySchemaSlug: "item",
					eventSchemaSlug: "progress",
					occurredAt: context.occurredAt,
				},
			},
		};
		expect(
			Schema.decodeUnknownSync(automationPolicyInputSchema)({ automation: request }).automation
				.payload,
		).toMatchObject({ category: "request" });
		expect(() =>
			Schema.decodeUnknownSync(automationInputSchema)({ automation: request }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(automationPolicyInputSchema)({
				automation: {
					...context,
					payload: {
						properties: {},
						operation: "emit",
						actorUserId: null,
						category: "signal",
						resource: "signal",
						signalSchemaPluginId: null,
						signalSchemaSlug: "changed",
					},
				},
			}),
		).toThrow();
	});

	test("compiles automations and policies to direct entrypoints", () => {
		const automation = defineAutomation({ run, manifest });
		const policyManifest = defineManifest({
			...manifest,
			automationType: "policy",
			inputProjection: { event: { properties: ["progress"] } },
		});
		const policy = defineAutomationPolicy({ run: policyRun, manifest: policyManifest });

		expect(automation).toMatchObject({
			run,
			manifest,
			input: automationInputSchema,
			output: automationResultSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
		expect(policy).toMatchObject({
			run: policyRun,
			manifest: policyManifest,
			input: automationPolicyInputSchema,
			output: automationPolicyResultSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
	});

	test("delivers the immutable signal and causation without an execution query", () => {
		const input = Schema.decodeUnknownSync(automationInputSchema)({
			automation: {
				runId: "run-1",
				executionUserId: null,
				triggerId: "trigger-1",
				hookSlug: "test.notify",
				hookMetadata: { title: "Updated" },
				occurredAt: "2026-07-29T00:00:00.000Z",
				causation: {
					depth: 0,
					parentRunId: null,
					parentTriggerId: null,
					executionId: "command-1",
					source: "provider-refresh",
					rootExecutionId: "command-1",
					initiator: { id: null, kind: "system" },
				},
				payload: {
					operation: "emit",
					actorUserId: null,
					category: "signal",
					resource: "signal",
					signalSchemaSlug: "test.updated",
					signalSchemaPluginId: "plugin-1",
					properties: { title: "Snapshot" },
				},
			},
		});

		expect(input.automation.payload).toEqual({
			operation: "emit",
			actorUserId: null,
			category: "signal",
			resource: "signal",
			signalSchemaSlug: "test.updated",
			signalSchemaPluginId: "plugin-1",
			properties: { title: "Snapshot" },
		});
		expect(input.automation.hookMetadata).toEqual({ title: "Updated" });
	});
});
