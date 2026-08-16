import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

it("formats workout.created exclusively from the inline signal", async () => {
	const messages: string[] = [];
	const input = Schema.decodeUnknownSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.notification",
			occurredAt: "2026-07-20T10:00:00.000Z",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				actorUserId: "user-1",
				signalSchemaSlug: "workout.created",
				signalSchemaPluginId: "fitness-plugin",
				properties: { workoutName: "Morning Run" },
			},
		},
	});
	const result = await Effect.runPromise(
		definition.run(
			input,
			defineSandboxTestHost(manifest, {
				sendNotification: (message) => {
					messages.push(message);
					return Effect.succeed(null);
				},
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		),
	);
	expect(result).toBeNull();
	expect(messages).toEqual(["Workout Morning Run was created"]);
});
