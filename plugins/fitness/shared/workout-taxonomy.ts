import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { exerciseKindSchema } from "./exercise-kinds";
import { NonNegativeInt } from "./fitness-primitives";
import { exerciseTargetRoleSchema } from "./taxonomy";

export const WORKOUT_TAXONOMY_LIMIT = 100;
export const WorkoutExercisePropertiesSchema = Schema.Struct({
	exerciseOrder: NonNegativeInt,
	exerciseKind: exerciseKindSchema,
	provenance: Schema.Literals(["recorded", "legacy"]),
	equipment: Schema.Array(EntityId).check(Schema.isMaxLength(WORKOUT_TAXONOMY_LIMIT)),
	targets: Schema.Array(
		Schema.Struct({ entityId: EntityId, role: Schema.NullOr(exerciseTargetRoleSchema) }),
	).check(Schema.isMaxLength(WORKOUT_TAXONOMY_LIMIT)),
});

export type WorkoutExerciseProperties = typeof WorkoutExercisePropertiesSchema.Type;
