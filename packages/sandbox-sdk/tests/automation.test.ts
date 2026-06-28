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

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	name: "Test automation",
	slug: "test-automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});
const run = () => Effect.succeed(null);
const policyRun = () => Effect.succeed({ action: "allow" as const });

describe("automation definitions", () => {
	test("compiles automations and policies to direct entrypoints", () => {
		const automation = defineAutomation({ run, manifest });
		const policy = defineAutomationPolicy({ manifest, run: policyRun });

		expect(automation).toMatchObject({
			run,
			manifest,
			input: automationInputSchema,
			output: automationResultSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
		expect(policy).toMatchObject({
			manifest,
			run: policyRun,
			input: automationPolicyInputSchema,
			output: automationPolicyResultSchema,
			definitionType: SANDBOX_SCRIPT_DEFINITION,
		});
	});

	test("accepts generic population parent context", () => {
		const input = Schema.decodeUnknownSync(automationInputSchema)({
			automation: {
				ruleId: "rule-1",
				operation: "update",
				source: { kind: "entity" },
				occurrenceId: "occurrence-1",
				origin: { kind: "provider_refresh" },
				occurredAt: "2026-07-29T00:00:00.000Z",
				population: {
					rootPreviouslyPopulated: true,
					scopeEntity: { id: "root-1", name: "Root", entitySchemaSlug: "root" },
					parentEntity: {
						name: "Container",
						properties: { ordinal: 1 },
						entitySchemaSlug: "container",
					},
				},
			},
		});

		expect(input.automation.population?.parentEntity).toEqual({
			name: "Container",
			properties: { ordinal: 1 },
			entitySchemaSlug: "container",
		});
	});
});
