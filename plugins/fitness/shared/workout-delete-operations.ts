import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

export const workoutDeleteOperationSlug = "workout-delete";

export const WorkoutDeleteInputSchema = Schema.Struct({
	entityId: EntityId,
	submissionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96)),
	submittedAt: Schema.String.check(
		Schema.makeFilter(
			(value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp",
		),
	),
});

export const WorkoutDeleteOutputSchema = Schema.Struct({ entityId: EntityId });
