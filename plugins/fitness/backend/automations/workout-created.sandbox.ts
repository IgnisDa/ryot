import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Workout Created Detector",
	slug: "automation.workout-created",
	inputProjection: { event: { compareProperties: [], properties: ["workoutName"] } },
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (
				payload.resource !== "event" ||
				payload.operation !== "create" ||
				payload.after.entitySchemaSlug !== "workout" ||
				payload.after.eventSchemaSlug !== "workout-completed"
			) {
				return null;
			}
			const workoutId = payload.after.entityId;
			const workoutName = payload.after.properties["workoutName"];
			if (typeof workoutName !== "string" || workoutName.length === 0) {
				return null;
			}

			return yield* host.emitSignal({
				discriminator: workoutId,
				schemaSlug: "workout.created",
				properties: { workoutId, workoutName },
			});
		}),
});
