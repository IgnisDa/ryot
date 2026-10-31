import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";

import { exerciseKinds } from "../../shared/exercise-kinds";
import { exerciseTargetRoles } from "../../shared/taxonomy";
import { WORKOUT_TAXONOMY_LIMIT } from "../../shared/workout-taxonomy";

const reference: AppPropertyDefinition = {
	type: "string",
	label: "Taxonomy entity",
	validation: { required: true },
	description: "Retained taxonomy identity",
	reference: { required: true, kind: "entity-id" },
};

export const workoutExercisePropertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		exerciseOrder: {
			type: "integer",
			label: "Exercise order",
			validation: { minimum: 0, required: true },
			description: "Exercise occurrence position",
		},
		equipment: {
			type: "array",
			items: reference,
			label: "Recorded equipment",
			description: "Frozen equipment identities",
			validation: { required: true, maxItems: WORKOUT_TAXONOMY_LIMIT },
		},
		exerciseKind: {
			type: "enum",
			label: "Recorded kind",
			validation: { required: true },
			description: "Kind at recording",
			choices: { kind: "static", values: exerciseKinds.map((value) => ({ value })) },
		},
		targets: {
			type: "array",
			label: "Recorded targets",
			description: "Frozen targets and roles",
			validation: { required: true, maxItems: WORKOUT_TAXONOMY_LIMIT },
			items: {
				type: "object",
				label: "Target",
				unknownKeys: "strict",
				description: "Frozen target assignment",
				properties: {
					entityId: reference,
					role: {
						type: "enum",
						label: "Role",
						description: "Recorded target role",
						choices: { kind: "static", values: exerciseTargetRoles.map((value) => ({ value })) },
					},
				},
			},
		},
	},
};
