import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import type { RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";

export type MappedRyotQueryState<State extends { readonly status: string }> =
	State | Exclude<RyotQueryState<never>, { readonly status: "ready" }>;

export type RyotQueryState<Value> =
	| { readonly status: "loading" }
	| { readonly status: "malformed" }
	| { readonly status: "transport-error" }
	| { readonly value: Value; readonly status: "ready" };

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
