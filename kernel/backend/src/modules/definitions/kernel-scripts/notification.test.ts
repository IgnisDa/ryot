import { expect, it } from "@effect/vitest";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { Cause, Exit } from "effect";

import definition, { manifest } from "./notification.sandbox";

const inputFor = (executionUserId: null | string, reminder = false) =>
	Schema.decodeEffect(automationInputSchema)({
		automation: {
			runId: "run-1",
			executionUserId,
			triggerId: "trigger-1",
			hookSlug: "automation.notification",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				parentRunId: null,
				lane: "background",
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
				signalSchemaSlug: reminder ? "reminder.due" : "integration.disabled",
				properties: reminder
					? {
							timezone: "Asia/Kolkata",
							entityTitle: "Target_[1]",
							message: "Read the notes_*",
							dueAt: "2026-09-15T08:30:00.000Z",
						}
					: { providerName: "Example", integrationId: "integration-1" },
			},
		},
	}).pipe(Effect.orDie);

it.effect("formats the inline signal for the trusted execution recipient", () =>
	Effect.gen(function* () {
		const messages: string[] = [];
		const result = yield* definition.run(
			yield* inputFor("recipient"),
			defineSandboxTestHost(manifest, {
				sendNotification: (message) => {
					messages.push(message);
					return Effect.succeed(null);
				},
			}),
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
				yield* inputFor(null),
				defineSandboxTestHost(manifest, {
					sendNotification: (message) => {
						messages.push(message);
						return Effect.succeed(null);
					},
				}),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Cause.pretty(exit.cause)).toContain("Signal notification requires an execution user");
		}
		expect(messages).toEqual([]);
	}),
);

it.effect("formats reminder evidence as plain text for the trusted recipient", () =>
	Effect.gen(function* () {
		const messages: string[] = [];
		yield* definition.run(
			yield* inputFor("recipient", true),
			defineSandboxTestHost(manifest, {
				sendNotification: (message) => {
					messages.push(message);
					return Effect.succeed(null);
				},
			}),
		);
		expect(messages).toEqual([
			"Target_[1]: Read the notes_*\nScheduled for 2026-09-15T08:30:00.000Z (Asia/Kolkata)",
		]);
	}),
);
