import { describe, expect, it } from "bun:test";

import { IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { Effect } from "effect";

import { requireSandboxCapabilityInput } from "#modules/scripts/authorization/capabilities";
import { makeSubjectRunInput } from "#modules/scripts/authorization/principal.test-support";

import { sandboxRunIntegrationId, sandboxRunUserId } from "./execution-context";

describe("script execution context", () => {
	it("uses execution user and trusted causation integration without subscription context", () => {
		const base = automationRunSubject("after", UserId.make("user_1"));
		const subject = {
			...base,
			causation: { ...base.causation, integrationId: IntegrationId.make("integration_1") },
		};
		const input = Effect.runSync(
			requireSandboxCapabilityInput(makeSubjectRunInput(subject), "getCurrentIntegration"),
		);
		expect(sandboxRunUserId(input)).toBe<unknown>("user_1");
		expect(sandboxRunIntegrationId(input)).toBe<unknown>("integration_1");
		expect(sandboxRunUserId(makeSubjectRunInput(automationRunSubject("after", null)))).toBeNull();
	});
});
