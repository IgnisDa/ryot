import {
	automationInputSchema,
	automationPolicyInputSchema,
	automationPolicyResultSchema,
	automationResultSchema,
	defineAutomation,
	defineAutomationPolicy,
} from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { describe, expect, test } from "vitest";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const manifest = defineManifest({
	kind: "automation",
	capabilities: [],
	name: "Test automation",
	slug: "test-automation",
	requiredAppConfigKeys: [],
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
});
