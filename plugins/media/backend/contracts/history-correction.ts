import { defineScriptReference, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const HistoryCorrectionRequest = Schema.Struct({
	force: Schema.Boolean,
	workKey: Schema.String,
	entityId: Schema.String,
	requestKey: Schema.String,
	conflictBase: Schema.String,
	conflictAttempt: Schema.Int,
	liveSourceIds: Schema.Array(Schema.String).check(Schema.isMaxLength(60)),
});

type HistoryCorrectionRequest = typeof HistoryCorrectionRequest.Type;

export const historyCorrectionWork = (input: HistoryCorrectionRequest) => ({
	input,
	key: input.workKey,
	scope: input.entityId,
});

export const startHistoryCorrection = (
	input: Omit<HistoryCorrectionRequest, "conflictBase" | "conflictAttempt">,
) => historyCorrectionWork({ ...input, conflictAttempt: 0, conflictBase: input.workKey });

export const historyCorrectionReference = defineScriptReference({
	output: Schema.Null,
	input: HistoryCorrectionRequest,
	scriptSlug: "media-history-correction",
});
