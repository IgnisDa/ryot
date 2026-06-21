import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { ImportEntityRunResult } from "@ryot/contract/modules/provider-entities/schemas";
import type { Workflow } from "effect/unstable/workflow";

import { toWorkflowRunResult } from "#lib/shared/workflow-result";

export const toEntityImportRunResult = <E extends { readonly message: string }>(
	result: Workflow.Result<ListedEntity, E> | undefined,
): ImportEntityRunResult =>
	toWorkflowRunResult(result, {
		failurePrefix: "Import failed: ",
		onSuccess: (data) => ({ data }),
	});
