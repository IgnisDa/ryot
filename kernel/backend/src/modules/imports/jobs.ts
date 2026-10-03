import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	command: LifecycleCommand,
	sourceStateId: Schema.String,
	dataJson: Schema.optional(Schema.Boolean),
	uploadIntentIds: Schema.Array(Schema.String),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
