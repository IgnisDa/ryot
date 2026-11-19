import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { SubmissionEnvelope } from "./fitness-primitives";

export const workoutDeleteOperationSlug = "workout-delete";
export const workoutTemplateDeleteOperationSlug = "workout-template-delete";

export const WorkoutDeleteInputSchema = Schema.Struct({
	...SubmissionEnvelope.fields,
	entityId: EntityId,
});

export const WorkoutDeleteOutputSchema = Schema.Struct({ entityId: EntityId });
