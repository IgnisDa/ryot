import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Workout Created Detector",
	slug: "automation.workout-created",
	inputProjection: {
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (
				payload.resource !== "entity" ||
				payload.operation !== "create" ||
				payload.after.entitySchemaSlug !== "workout"
			) {
				return null;
			}
			const entity = payload.after;

			return yield* host.emitSignal({
				discriminator: entity.id,
				schemaSlug: "workout.created",
				properties: { workoutId: entity.id, workoutName: entity.name },
			});
		}),
});
