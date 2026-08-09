import { RyotClientError } from "@ryot-app/client-sdk";
import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

export type RyotQueryState<Value> =
	| { readonly status: "loading" }
	| { readonly status: "malformed" }
	| { readonly status: "transport-error" }
	| { readonly status: "ready"; readonly value: Value };

export type MappedRyotQueryState<State extends { readonly status: string }> =
	| Exclude<RyotQueryState<never>, { readonly status: "ready" }>
	| State;

export const classifyRyotQueryResult = <Value>(
	result: RyotQueryResult<Value>,
): RyotQueryState<Value> => {
	if (result.data !== undefined) {
		return { status: "ready", value: result.data };
	}
	if (result.status !== "error") {
		return { status: "loading" };
	}
	return {
		status:
			result.error instanceof RyotClientError && result.error.reason === "malformed-result"
				? "malformed"
				: "transport-error",
	};
};
