import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

export const manifest = defineManifest({
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Workout Created Detector",
	slug: "automation.workout-created",
	capabilities: ["executeRyotql", "emitSignal"],
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const occurrence = yield* executeRyotqlRecipe(
				host.executeRyotql,
				automationOccurrenceRecipe(automation.occurrenceId),
			);
			const entity = occurrence?.source.kind === "entity" ? occurrence.source.after : undefined;
			if (automation.origin.kind !== "api" || entity?.entitySchemaSlug !== "workout") {
				return null;
			}

			return yield* host.emitSignal({
				discriminator: entity.id,
				schemaSlug: "workout.created",
				properties: { workoutId: entity.id, workoutName: entity.name },
			});
		}),
});
