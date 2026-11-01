import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	command: LifecycleCommand,
	dataJson: Schema.optional(Schema.Boolean),
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
