import { expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { englishRenderer, signalAutomationInput } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { englishCatalog } from "../../tests/english-catalog";
import definition from "./notification.sandbox";

const notificationInput = (signalSchemaSlug: string, properties: Record<string, unknown>) =>
	signalAutomationInput({
		properties,
		signalSchemaSlug,
		hookSlug: "fitness.notification",
		signalSchemaPluginId: "fitness-plugin",
	});

it.effect(
	"builds the workout.created message exclusively from the inline signal",
	() =>
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* notificationInput("workout.created", { workoutName: "Morning Run" }),
			);
			expect(result.changes.notifications.map(englishRenderer(englishCatalog))).toEqual([
				"Workout Morning Run was created",
			]);
		}),
	testTimeout,
);
