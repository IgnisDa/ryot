import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { userFitnessLibraryRecipe } from "../../shared/library-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Ensure fitness library membership",
	slug: "automation.ensure-fitness-library-membership",
	inputProjection: {
		providerEntityImport: true,
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const exerciseIdOf = (payload: AutomationInput["automation"]["payload"]) => {
	if (payload.resource === "provider-entity-import" && payload.entitySchemaSlug === "exercise") {
		return payload.entityId;
	}
	if (
		payload.resource === "entity" &&
		payload.operation === "create" &&
		"after" in payload &&
		payload.after.entitySchemaSlug === "exercise"
	) {
		return payload.after.id;
	}
	return undefined;
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			const exerciseId = exerciseIdOf(payload);
			if (exerciseId === undefined) {
				return null;
			}
			const fitnessLibrary = yield* executeRyotqlRecipe(
				host.executeRyotql,
				userFitnessLibraryRecipe(),
			);
			yield* host.changeUserRelationships([
				{
					deletes: [],
					creates: [
						{
							properties: {},
							sourceEntityId: exerciseId,
							targetEntityId: fitnessLibrary.entityId,
							relationshipSchemaSlug: "in-fitness-library",
						},
					],
				},
			]);
			return null;
		}),
});
