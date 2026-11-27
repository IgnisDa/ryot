import { expect } from "bun:test";

import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { englishRenderer, recordNotifications } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { englishCatalog } from "../../tests/english-catalog";
import definition, { manifest } from "./notification.sandbox";

const notificationInput = (signalSchemaSlug: string, properties: Record<string, unknown>) =>
	Schema.decodeUnknownEffect(automationInputSchema)({
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
				lane: "interactive",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	}).pipe(Effect.orDie);

it.effect(
	"builds the workout.created message exclusively from the inline signal",
	() =>
		Effect.gen(function* () {
			const { host, messages } = recordNotifications(manifest);
			const result = yield* definition.run(
				yield* notificationInput("workout.created", { workoutName: "Morning Run" }),
				host,
			);
			expect(result).toBeNull();
			expect(messages.map(englishRenderer(englishCatalog))).toEqual([
				"Workout Morning Run was created",
			]);
		}),
	testTimeout,
);
