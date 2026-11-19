import type {
	AuthoredAppSchema,
	AuthoredSchemaText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import type { AppPropertyDefinition } from "@ryot-app/contract/schema/property-schema";

import { exerciseKinds } from "../../shared/exercise-kinds";
import { catalogMessage } from "../../shared/messages.generated";
import { exerciseTargetRoles } from "../../shared/taxonomy";
import { WORKOUT_TAXONOMY_LIMIT } from "../../shared/workout-taxonomy";

const reference: AppPropertyDefinition<AuthoredSchemaText> = {
	type: "string",
	validation: { required: true },
	description: "Retained taxonomy identity",
	reference: { required: true, kind: "entity-id" },
	label: catalogMessage("property.taxonomy-entity"),
};

export const workoutExercisePropertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: {
		exerciseOrder: {
			type: "integer",
			validation: { minimum: 0, required: true },
			description: "Exercise occurrence position",
			label: catalogMessage("property.exercise-order-2"),
		},
		equipment: {
			type: "array",
			items: reference,
			description: "Frozen equipment identities",
			label: catalogMessage("property.recorded-equipment"),
			validation: { required: true, maxItems: WORKOUT_TAXONOMY_LIMIT },
		},
		exerciseKind: {
			type: "enum",
			validation: { required: true },
			description: "Kind at recording",
			label: catalogMessage("property.recorded-kind"),
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},
		targets: {
			type: "array",
			description: "Frozen targets and roles",
			label: catalogMessage("property.recorded-targets"),
			validation: { required: true, maxItems: WORKOUT_TAXONOMY_LIMIT },
			items: {
				type: "object",
				unknownKeys: "strict",
				description: "Frozen target assignment",
				label: catalogMessage("property.target"),
				properties: {
					entityId: reference,
					role: {
						type: "enum",
						description: "Recorded target role",
						label: catalogMessage("property.role"),
						choices: { kind: "static", values: exerciseTargetRoles.map((value) => ({ value })) },
					},
				},
			},
		},
	},
};
