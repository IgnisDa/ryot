import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { ImportRunExecutionKind } from "./repository";
import type { ImportRunError } from "./runtime/workflow-errors";

type ImportRunExecutionControllerValue = {
	readonly interrupt: (input: {
		readonly runId: ImportRunId;
		readonly executionKind: ImportRunExecutionKind;
	}) => Effect.Effect<void, ImportRunError>;
};

export class ImportRunExecutionController extends Context.Service<
	ImportRunExecutionController,
	ImportRunExecutionControllerValue
>()("ImportRunExecutionController") {}
