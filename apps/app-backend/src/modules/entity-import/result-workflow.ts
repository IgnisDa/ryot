import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { ImportEntityRunResult } from "@ryot/contract/modules/entity-import/schemas";
import type { Workflow } from "effect/unstable/workflow";

import { toWorkflowRunResult } from "#lib/shared/workflow-result";

export type EntityImportRunResult = typeof ImportEntityRunResult.Type;

export const toEntityImportRunResult = <E extends { readonly message: string }>(
	result: Workflow.Result<ListedEntity, E> | undefined,
): EntityImportRunResult =>
	toWorkflowRunResult(result, {
		failurePrefix: "Import failed: ",
		onSuccess: (data) => ({ data }),
	});
