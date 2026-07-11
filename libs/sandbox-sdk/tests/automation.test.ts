import {
	automationInputSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
	automationResultSchema,
	defineAutomation,
	defineAutomationPolicy,
} from "@ryot/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { describe, expect, test } from "vitest";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({
	kind: "automation",
	capabilities: [],
	name: "Test automation",
	slug: "test-automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});
const run = () => Effect.succeed(null);
const policyRun = () => Effect.succeed({ action: "allow" as const });

describe("automation definitions", () => {
	test("compiles automations and policies to direct entrypoints", () => {
		const automation = defineAutomation({ manifest, run });
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
		expect(automation).not.toHaveProperty("drivers");
		expect(policy).not.toHaveProperty("drivers");
	});

	test("accepts generic population parent context", () => {
		const input = Schema.decodeUnknownSync(automationInputSchema)({
			automation: {
				ruleId: "rule-1",
				operation: "update",
				origin: { kind: "provider_refresh" },
				occurrenceId: "occurrence-1",
				occurredAt: "2026-07-29T00:00:00.000Z",
				source: { kind: "entity" },
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
