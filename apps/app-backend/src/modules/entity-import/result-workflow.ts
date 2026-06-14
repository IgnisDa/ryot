import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { SandboxRunError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { ImportEntityRunResult } from "@ryot/contract/modules/entity-import/schemas";
import { Cause, Exit, Match, Option } from "effect";

export type EntityImportRunResult = typeof ImportEntityRunResult.Type;

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<EntityImportRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Import failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
	});

export const toEntityImportRunResult = (
	result: WorkflowResult<ListedEntity, SandboxRunError> | undefined,
): EntityImportRunResult => {
	if (!result) {
		return { status: "pending" };
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => ({ status: "pending" as const })),
		Match.orElse(({ exit }) =>
			Exit.match(exit, {
				onFailure: workflowFailureResult,
				onSuccess: (data) => ({ status: "completed" as const, data }),
			}),
		),
	);
};
