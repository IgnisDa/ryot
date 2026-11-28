import type { SandboxRunError } from "@ryot-app/contract/errors";
import {
	stampBoundaryReason,
	StampedSandboxBoundaryReason,
} from "@ryot-app/contract/modules/scripts/boundary-reason";
import { SandboxExecutionError } from "@ryot-app/contract/modules/scripts/schemas";
import { Schema } from "effect";

import { principalMessageNamespace } from "#modules/scripts/authorization/principal";

/** A sandbox failure whose boundary reason carries the run's stamped catalog namespace. */
export const StampedSandboxExecutionError = Schema.Struct({
	...SandboxExecutionError.fields,
	data: Schema.optional(StampedSandboxBoundaryReason),
});

export type StampedSandboxExecutionError = typeof StampedSandboxExecutionError.Type;

/** Stamps a failure the sandbox reported with the catalog namespace of the run's principal. */
export const stampSandboxExecutionError = (
	principal: Parameters<typeof principalMessageNamespace>[0],
	{ data, ...error }: SandboxExecutionError,
): StampedSandboxExecutionError => {
	const namespace = principalMessageNamespace(principal);
	const stamped = data === undefined ? undefined : stampBoundaryReason(namespace, data);
	return stamped === undefined ? error : { ...error, data: stamped };
};
const SandboxTiming = Schema.Struct({ totalMs: Schema.Finite, executionMs: Schema.Finite });

export const SandboxExecutionResult = Schema.Struct({
	value: Schema.Unknown,
	logs: Schema.Array(Schema.String),
	status: Schema.Literal("completed"),
	timing: Schema.optional(SandboxTiming),
	error: Schema.NullOr(StampedSandboxExecutionError),
	harvest: Schema.optional(
		Schema.NullOr(Schema.Struct({ chunkHandles: Schema.Array(Schema.String) })),
	),
});

export type SandboxExecutionResult = Schema.Schema.Type<typeof SandboxExecutionResult>;

/** A run that failed before the sandbox reported a result, as a completed execution. */
export const sandboxExecutionFailure = (error: SandboxRunError) => ({
	logs: [],
	value: null,
	status: "completed" as const,
	error: {
		kind: error.kind,
		message: error.message,
		phase: "execute" as const,
		...(error.data === undefined ? {} : { data: error.data }),
	},
});
