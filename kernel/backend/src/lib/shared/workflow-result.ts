import { Cause, Exit, Option } from "effect";
import type { Workflow } from "effect/unstable/workflow";

export type WorkflowRunResult<Completed extends object> =
	| { readonly status: "pending" }
	| { readonly error: string; readonly status: "failed" }
	| ({ readonly status: "completed" } & Completed);

export const toWorkflowRunResult = <
	A,
	E extends { readonly message: string },
	Completed extends object,
>(
	result: Workflow.Result<A, E> | undefined,
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
		onFailure: (cause) => ({
			status: "failed" as const,
			error: Option.match(Cause.findErrorOption(cause), {
				onSome: (error) => options.onFailure?.(error) ?? error.message,
				onNone: () => `${options.failurePrefix ?? ""}${Cause.pretty(cause).slice(0, 500)}`,
			}),
		}),
		onSuccess: (value) => ({ status: "completed" as const, ...options.onSuccess(value) }),
	});
};
