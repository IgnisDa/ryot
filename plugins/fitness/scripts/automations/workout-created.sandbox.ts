import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Workout Created Detector",
	slug: "automation.workout-created",
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const entity = automation.source.kind === "entity" ? automation.source.after : undefined;
		if (automation.origin.kind !== "api" || entity?.entitySchemaSlug !== "workout") {
			return Effect.succeed(null);
		}

		return host.emitSignal({
			discriminator: entity.id,
			schemaSlug: "workout.created",
			properties: { workoutId: entity.id, workoutName: entity.name },
		});
	},
});
