import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { ImportEntityRunResult } from "@ryot/contract/modules/entity-import/schemas";
import { Cause, Exit, Match, Option } from "effect";

export type EntityImportRunResult = typeof ImportEntityRunResult.Type;

const workflowFailureResult = <E extends { readonly message: string }>(
	cause: Cause.Cause<E>,
): Extract<EntityImportRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onSome: (error) => ({ status: "failed", error: error.message }),
		onNone: () => ({
			status: "failed",
			error: `Import failed: ${Cause.pretty(cause).slice(0, 500)}`,
		}),
	});

export const toEntityImportRunResult = <E extends { readonly message: string }>(
	result: WorkflowResult<ListedEntity, E> | undefined,
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
