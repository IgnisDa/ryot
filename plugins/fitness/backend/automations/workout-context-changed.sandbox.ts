import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Workout Context Change Detector",
	slug: "automation.workout-context-changed",
	inputProjection: {
		entity: {
			properties: [],
			parentEntityProperties: [],
			compareProperties: [
				{ equality: "json", property: "kind" },
				{ equality: "json", property: "startedAt" },
			],
		},
	},
});

type EntityUpdate = Extract<
	AutomationInput["automation"]["payload"],
	{ operation: "update"; resource: "entity" }
>;

const changedSignal = (payload: EntityUpdate) => {
	const { after, changedProperties } = payload;
	if (after.entitySchemaSlug === "exercise" && changedProperties.includes("kind")) {
		return "exercise.context-changed";
	}
	if (after.entitySchemaSlug === "workout" && changedProperties.includes("startedAt")) {
		return "workout.context-changed";
	}
	return null;
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (payload.resource !== "entity" || payload.operation !== "update") {
				return null;
			}
			const schemaSlug = changedSignal(payload);
			if (schemaSlug === null) {
				return null;
			}
			return yield* host.emitSignal({
				schemaSlug,
				properties: {},
				discriminator: payload.after.id,
				subjectEntityId: payload.after.id,
			});
		}),
});
