import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	sourceStateId: Schema.String,
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
