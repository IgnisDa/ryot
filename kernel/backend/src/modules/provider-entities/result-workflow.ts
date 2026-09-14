import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { ImportEntityRunResult } from "@ryot-app/contract/modules/provider-entities/schemas";
import { Cause, Exit, Option } from "effect";
import type { Workflow } from "effect/unstable/workflow";

export const toEntityImportRunResult = <
	E extends { readonly stage: "population" | "provider-import-automation" },
>(
	result: Workflow.Result<ListedEntity, E> | undefined,
): ImportEntityRunResult => {
	if (result === undefined || result._tag === "Suspended") {
		return { status: "pending" };
	}
	return Exit.match(result.exit, {
		onSuccess: (data) => ({ data, status: "completed" as const }),
		onFailure: (cause) => ({
			status: "failed" as const,
			reason: {
				code: "import-failed" as const,
				stage: Option.match(Cause.findErrorOption(cause), {
					onSome: (error) => error.stage,
					onNone: () => "unexpected" as const,
				}),
			},
		}),
	});
};
