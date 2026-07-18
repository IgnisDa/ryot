import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";

export const ImportRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	command: LifecycleCommand,
	sourceStateId: Schema.String,
});

export type ImportRunJobData = typeof ImportRunJobData.Type;
