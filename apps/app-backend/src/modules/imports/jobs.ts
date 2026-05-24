import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	runId: Schema.String,
	userId: Schema.String,
	source: Schema.String,
	filePath: Schema.String,
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
