import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
	capabilities: ["executeRyotql", "sendNotification"],
});

const workoutCreatedPropertiesSchema = Schema.Struct({ workoutName: Schema.String });

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const occurrence = yield* executeRyotqlRecipe(
				host.executeRyotql,
				automationOccurrenceRecipe(automation.occurrenceId),
			);
			if (occurrence?.source.kind !== "signal") {
				return yield* Effect.fail(new Error("Signal notification requires a signal source"));
			}
			const signal = occurrence.source.signal;
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
