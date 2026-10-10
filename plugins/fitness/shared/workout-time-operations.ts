import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { WorkoutActiveDurationChangeSchema } from "./workout-editor-operations";

const timestamp = Schema.String.check(
	Schema.makeFilter((value) => Number.isFinite(Date.parse(value)) || "Expected a valid timestamp"),
);
export const WorkoutTimeCorrectionInputSchema = Schema.Struct({
	entityId: EntityId,
	startedAt: timestamp,
	submittedAt: timestamp,
	conflictToken: Schema.String,
	endedAt: Schema.optional(timestamp),
	activeDuration: WorkoutActiveDurationChangeSchema,
	submissionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96)),
});
export const WorkoutTimeCorrectionOutputSchema = Schema.Union([
	Schema.Struct({ entityId: EntityId, kind: Schema.Literal("saved") }),
	Schema.Struct({ kind: Schema.Literal("conflict") }),
	Schema.Struct({ kind: Schema.Literal("invalid") }),
]);
