import { expect, it } from "@effect/vitest";
import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { Cause, Exit } from "effect";

import definition, { manifest } from "./notification.sandbox";

const inputFor = (executionUserId: string | null) =>
	Schema.decodeSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			executionUserId,
			triggerId: "trigger-1",
			hookSlug: "automation.notification",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				parentRunId: null,
				source: "integration",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { id: "actor", kind: "user" },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				actorUserId: "actor",
				signalSchemaPluginId: null,
				signalSchemaSlug: "integration.disabled",
				properties: { providerName: "Example", integrationId: "integration-1" },
			},
		},
	});

it.effect("formats the inline signal for the trusted execution recipient", () =>
	Effect.gen(function* () {
		const messages: string[] = [];
		const result = yield* definition.run(
			inputFor("recipient"),
			defineSandboxTestHost(manifest, {
				sendNotification: (message) => {
					messages.push(message);
					return Effect.succeed(null);
				},
			}),
			{ metadata: {}, sandboxScriptId: "kernel-notification" },
		);
		expect(result).toBeNull();
		expect(messages).toEqual(["Integration Example has been disabled due to too many errors"]);
	}),
);

it.effect("does not use the actor as a fallback for a missing execution recipient", () =>
	Effect.gen(function* () {
		const messages: string[] = [];
		const exit = yield* Effect.exit(
			definition.run(
				inputFor(null),
				defineSandboxTestHost(manifest, {
					sendNotification: (message) => {
						messages.push(message);
						return Effect.succeed(null);
					},
				}),
				{ metadata: {}, sandboxScriptId: "kernel-notification" },
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Cause.pretty(exit.cause)).toContain("Signal notification requires an execution user");
		}
		expect(messages).toEqual([]);
	}),
);
