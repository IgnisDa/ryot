import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["sendNotification"],
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
});

const workoutCreatedPropertiesSchema = Schema.Struct({ workoutName: Schema.String });

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			if (automation.source.kind !== "signal") {
				return yield* Effect.fail(new Error("Signal notification requires a signal source"));
			}
			const signal = automation.source.signal;
			if (signal.signalSchemaSlug !== "workout.created") {
				return yield* Effect.fail(
					new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`),
				);
			}
			const properties = yield* Schema.decodeUnknown(workoutCreatedPropertiesSchema)(
				signal.properties,
			).pipe(Effect.mapError(() => new Error("Signal property workoutName must be a string")));
			return yield* host.sendNotification(`Workout ${properties.workoutName} was created`);
		}),
});
