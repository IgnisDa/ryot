import { Cause, Exit, Option } from "effect";
import type { Workflow } from "effect/workflow";

export type WorkflowRunResult<Completed extends object> =
	| { readonly status: "pending" }
	| (Completed & { readonly status: "completed" })
	| { readonly error: string; readonly status: "failed" };

export const toWorkflowRunResult = <
	A,
	E extends { readonly message: string },
	Completed extends object,
>(
	result: undefined | Workflow.Result<A, E>,
	options: {
		readonly failurePrefix?: string;
		readonly onFailure?: (error: E) => string;
		readonly onSuccess: (value: A) => Completed;
	},
): WorkflowRunResult<Completed> => {
	if (!result) {
		return { status: "pending" };
	}

	if (result._tag === "Suspended") {
		return { status: "pending" };
	}

	return Exit.match(result.exit, {
		onSuccess: (value) => ({ status: "completed" as const, ...options.onSuccess(value) }),
		onFailure: (cause) => ({
			status: "failed" as const,
			error: Option.match(Cause.findErrorOption(cause), {
				onSome: (error) => options.onFailure?.(error) ?? error.message,
				onNone: () => `${options.failurePrefix ?? ""}${Cause.pretty(cause).slice(0, 500)}`,
			}),
		}),
	});
};
