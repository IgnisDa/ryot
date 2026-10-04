import { IntegrationId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { requireSandboxCapabilityInput } from "@ryot-app/sandbox/host/invocation";
import {
	automationRunSubject,
	makeSubjectRunInput,
} from "@ryot-app/sandbox/host/run-input.test-support";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
	sandboxLifecycleCommand,
	sandboxRunIntegrationId,
	sandboxRunUserId,
} from "./execution-context";

describe("script execution context", () => {
	it("derives trusted source-specific root lifecycle commands", () => {
		const trusted = {
			hostCallDiscriminator: 7,
			workflowExecutionId: "workflow-1",
			startedAt: "2026-09-16T10:00:00.000Z",
		};
		const integration = Effect.runSync(
			sandboxLifecycleCommand(
				{
					...makeSubjectRunInput({
						type: "user",
						userId: UserId.make("user-1"),
						integrationId: IntegrationId.make("integration-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					}),
					...trusted,
				},
				"integration",
				"changeUserRelationships",
			),
		);
		expect(integration).toMatchObject({
			occurredAt: trusted.startedAt,
			itemIdentity: "changeUserRelationships",
			causation: {
				depth: 0,
				source: "integration",
				integrationId: "integration-1",
				executionId: "workflow-1-host-7",
				rootExecutionId: "workflow-1-host-7",
				initiator: { kind: "integration", id: "integration-1" },
			},
		});

		const provider = Effect.runSync(
			sandboxLifecycleCommand(
				{
					...makeSubjectRunInput({ type: "system" }, SandboxProviderId.make("provider-1")),
					...trusted,
				},
				"provider-refresh",
				"upsertGlobalEntities",
			),
		);
		expect(provider.causation).toMatchObject({
			source: "provider-refresh",
			executionId: "workflow-1-host-7",
			providerExecutionId: "workflow-1",
			initiator: { id: null, kind: "system" },
		});
	});

	it("uses execution user and trusted causation integration without subscription context", () => {
		const base = automationRunSubject("after", UserId.make("user_1"));
		const subject = {
			...base,
			causation: { ...base.causation, integrationId: IntegrationId.make("integration_1") },
		};
		const input = Effect.runSync(
			requireSandboxCapabilityInput(makeSubjectRunInput(subject), "getCurrentIntegration"),
		);
		expect(sandboxRunUserId(input)).toBe("user_1");
		expect(sandboxRunIntegrationId(input)).toBe("integration_1");
		expect(sandboxRunUserId(makeSubjectRunInput(automationRunSubject("after", null)))).toBeNull();
	});
});
