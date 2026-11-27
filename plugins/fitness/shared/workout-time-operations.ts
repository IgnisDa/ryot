import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { IsoTimestamp, SubmissionEnvelope } from "./fitness-primitives";
import { WorkoutActiveDurationChangeSchema } from "./workout-editor-operations";

export const WorkoutTimeCorrectionInputSchema = Schema.Struct({
	...SubmissionEnvelope.fields,
	entityId: EntityId,
	startedAt: IsoTimestamp,
	conflictToken: Schema.String,
	endedAt: Schema.optional(IsoTimestamp),
	activeDuration: WorkoutActiveDurationChangeSchema,
});
export const WorkoutTimeCorrectionOutputSchema = Schema.Union([
	Schema.Struct({ entityId: EntityId, kind: Schema.Literal("saved") }),
	Schema.Struct({ kind: Schema.Literal("conflict") }),
	Schema.Struct({ kind: Schema.Literal("invalid") }),
]);
