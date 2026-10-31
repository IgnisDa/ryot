import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
	inputProjection: { signal: { properties: ["workoutName"] } },
});

const workoutCreatedPropertiesSchema = Schema.Struct({ workoutName: Schema.String });

class FitnessNotificationError extends Schema.TaggedError<
	FitnessNotificationError,
	{ readonly brand: unique symbol }
>()("FitnessNotificationError", { message: Schema.String }) {}

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const signal = automation.payload;
			if (signal.resource !== "signal") {
				return yield* new FitnessNotificationError({
					message: "Signal notification requires a signal source",
				});
			}
			if (signal.signalSchemaSlug !== "workout.created") {
				return yield* new FitnessNotificationError({
					message: `Unsupported signal schema: ${signal.signalSchemaSlug}`,
				});
			}
			const properties = yield* Schema.decodeUnknownEffect(workoutCreatedPropertiesSchema)(
				signal.properties,
			).pipe(
				Effect.mapError(
					() =>
						new FitnessNotificationError({
							message: "Signal property workoutName must be a string",
						}),
				),
			);
			return yield* host.sendNotification(`Workout ${properties.workoutName} was created`);
		}),
});
