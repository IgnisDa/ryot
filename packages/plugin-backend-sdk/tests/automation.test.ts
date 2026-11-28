import { describe, expect, test } from "bun:test";

import {
	automationInputSchema,
	automationPolicyBatchInputSchema,
	automationPolicyBatchResultSchema,
	automationPolicyInputSchema,
	defineAutomation,
	defineAutomationPolicy,
	notifySignals,
	SignalNotificationError,
} from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { signalAutomationInput } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { changesOutputSchema, sandboxManifestSchema } from "../src/core";
import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({
	kind: "automation",
	name: "Test automation",
	slug: "test-automation",
	automationType: "automation",
	inputProjection: {
		event: {
			properties: ["progress"],
			compareProperties: [{ equality: "json", property: "progress" }],
		},
	},
});
const run = () => Effect.succeed({});
const policyRun = () => Effect.succeed({ items: [] });

describe("automation definitions", () => {
	it.effect(
		"rejects authored capabilities on policy manifests at the SDK boundary",
		() =>
			Effect.gen(function* () {
				for (const capability of [
					"log",
					"httpCall",
					"setCachedValue",
					"claimPersistentValue",
					"scratch",
				]) {
					yield* Effect.flip(
						Schema.decodeUnknownEffect(sandboxManifestSchema)({
							...manifest,
							automationType: "policy",
							capabilities: [capability],
							inputProjection: { event: { properties: ["progress"] } },
						}),
					);
				}
			}),
		testTimeout,
	);

	it.effect(
		"separates request policies from committed-change invocations",
		() =>
			Effect.gen(function* () {
				const context = {
					hookSlug: "test.policy",
					executionUserId: "user-1",
					occurredAt: "2026-09-15T00:00:00.000Z",
					causation: {
						depth: 0,
						source: "api",
						parentRunId: null,
						lane: "interactive",
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
							eventSchemaPluginId: null,
							entitySchemaPluginId: null,
							eventSchemaSlug: "progress",
							occurredAt: context.occurredAt,
						},
					},
				};
				expect(
					(yield* Schema.decodeUnknownEffect(automationPolicyInputSchema)({ automation: request }))
						.automation.payload,
				).toMatchObject({ category: "request" });
				yield* Effect.flip(
					Schema.decodeUnknownEffect(automationInputSchema)({
						automation: { ...request, runId: "run-1", triggerId: "trigger-1" },
					}),
				);
				yield* Effect.flip(
					Schema.decodeUnknownEffect(automationPolicyInputSchema)({
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
				);
			}),
		testTimeout,
	);

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
			output: changesOutputSchema,
			input: automationInputSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
		expect(policy).toMatchObject({
			run: policyRun,
			manifest: policyManifest,
			input: automationPolicyBatchInputSchema,
			output: automationPolicyBatchResultSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
	});

	it.effect(
		"delivers the immutable signal and causation without an execution query",
		() =>
			Effect.gen(function* () {
				const input = yield* Schema.decodeEffect(automationInputSchema)({
					automation: {
						runId: "run-1",
						executionUserId: null,
						triggerId: "trigger-1",
						hookSlug: "test.notify",
						hookMetadata: { title: "Updated" },
						occurredAt: "2026-07-29T00:00:00.000Z",
						payload: {
							operation: "emit",
							actorUserId: null,
							category: "signal",
							resource: "signal",
							signalSchemaSlug: "test.updated",
							signalSchemaPluginId: "plugin-1",
							properties: { title: "Snapshot" },
						},
						causation: {
							depth: 0,
							parentRunId: null,
							lane: "interactive",
							parentTriggerId: null,
							executionId: "command-1",
							source: "provider-refresh",
							rootExecutionId: "command-1",
							initiator: { id: null, kind: "system" },
						},
					},
				});

				expect(input.automation.payload).toEqual<unknown>({
					operation: "emit",
					actorUserId: null,
					category: "signal",
					resource: "signal",
					signalSchemaSlug: "test.updated",
					signalSchemaPluginId: "plugin-1",
					properties: { title: "Snapshot" },
				});
				expect(input.automation.hookMetadata).toEqual({ title: "Updated" });
			}),
		testTimeout,
	);
});

const signal = (properties: Readonly<Record<string, unknown>>) =>
	signalAutomationInput({
		properties,
		hookSlug: "test-notification",
		signalSchemaSlug: "count.changed",
	});

describe("signal notifications", () => {
	const notification = defineAutomation({
		run: notifySignals({
			"count.changed": {
				properties: Schema.Struct({ count: Schema.Finite }),
				notify: ({ count }) => ({ params: { count }, key: "notification.count" }),
			},
		}),
		manifest: defineManifest({
			kind: "automation",
			slug: "test-notification",
			name: "Test notification",
			automationType: "automation",
			inputProjection: { signal: { properties: ["count"] } },
		}),
	});
	it.effect(
		"formats a signal's decoded properties and fails typed on properties it cannot decode",
		() =>
			Effect.gen(function* () {
				expect(yield* notification.run(yield* signal({ count: 2 }))).toEqual({
					changes: { notifications: [{ params: { count: 2 }, key: "notification.count" }] },
				});
				const failure = yield* Effect.flip(notification.run(yield* signal({ count: "two" })));
				expect(failure).toBeInstanceOf(SignalNotificationError);
				expect(failure.message).toContain("count.changed has invalid properties");
			}),
		testTimeout,
	);
});
