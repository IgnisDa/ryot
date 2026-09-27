import { automationInputSchema } from "@ryot-app/sandbox-sdk/automation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const notificationInput = (signalSchemaSlug: string, properties: Record<string, unknown>) =>
	Schema.decodeUnknownSync(automationInputSchema)({
		automation: {
			runId: "run-1",
			triggerId: "trigger-1",
			executionUserId: "user-1",
			hookSlug: "fitness.notification",
			occurredAt: "2026-07-20T10:00:00.000Z",
			payload: {
				properties,
				signalSchemaSlug,
				operation: "emit",
				category: "signal",
				resource: "signal",
				actorUserId: "user-1",
				signalSchemaPluginId: "fitness-plugin",
			},
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	});

it("formats workout.created exclusively from the inline signal", () => {
	const messages: string[] = [];
	return Effect.runPromise(
		definition
			.run(
				notificationInput("workout.created", { workoutName: "Morning Run" }),
				defineSandboxTestHost(manifest, {
					sendNotification: (message) => {
						messages.push(message);
						return Effect.succeed(null);
					},
				}),
			)
			.pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(messages).toEqual(["Workout Morning Run was created"]);
					return result;
				}),
			),
	);
});

it.each(["exercise.context-changed", "workout.context-changed"])(
	"does not notify for internal %s signals",
	(signalSchemaSlug) => {
		const messages: string[] = [];
		return Effect.runPromise(
			definition
				.run(
					notificationInput(signalSchemaSlug, {}),
					defineSandboxTestHost(manifest, {
						sendNotification: (message) => {
							messages.push(message);
							return Effect.succeed(null);
						},
					}),
				)
				.pipe(
					Effect.map((result) => {
						expect(result).toBeNull();
						expect(messages).toEqual([]);
					}),
				),
		);
	},
);
