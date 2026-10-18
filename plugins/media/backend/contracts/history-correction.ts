import { defineScriptReference, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const HistoryCorrectionRequest = Schema.Struct({
	force: Schema.Boolean,
	workKey: Schema.String,
	entityId: Schema.String,
	requestKey: Schema.String,
	conflictAttempt: Schema.Int,
	liveSourceIds: Schema.Array(Schema.String).check(Schema.isMaxLength(60)),
});

export const historyCorrectionReference = defineScriptReference({
	output: Schema.Null,
	input: HistoryCorrectionRequest,
	scriptSlug: "media-history-correction",
});
