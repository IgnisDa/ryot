import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["sendNotification"],
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
	inputProjection: { signal: { properties: ["workoutName"] } },
});

const workoutCreatedPropertiesSchema = Schema.Struct({ workoutName: Schema.String });

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const signal = automation.payload;
			if (signal.resource !== "signal") {
				return yield* Effect.fail(new Error("Signal notification requires a signal source"));
			}
			if (signal.signalSchemaSlug !== "workout.created") {
				return yield* Effect.fail(
					new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`),
				);
			}
			const properties = yield* Schema.decodeUnknownEffect(workoutCreatedPropertiesSchema)(
				signal.properties,
			).pipe(Effect.mapError(() => new Error("Signal property workoutName must be a string")));
			return yield* host.sendNotification(`Workout ${properties.workoutName} was created`);
		}),
});
