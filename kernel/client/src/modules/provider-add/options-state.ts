import type { SearchProviderOptionsResponse } from "@ryot/contract/modules/provider-entities/schemas";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";

import type { ProviderSearchSummary } from "./state";

export type ProviderOptionsState =
	| { readonly status: "loading"; readonly providerId: SandboxProviderId }
	| { readonly status: "none"; readonly providerId: SandboxProviderId | undefined }
	| { readonly cause: unknown; readonly status: "failed"; readonly providerId: SandboxProviderId }
	| {
			readonly status: "ready";
			readonly schema: AppSchema;
			readonly providerId: SandboxProviderId;
	  };

export const createProviderOptionsState = (
	provider: ProviderSearchSummary | undefined,
): ProviderOptionsState => {
	if (provider === undefined) {
		return { providerId: undefined, status: "none" };
	}
	if (provider.searchOptionsSchema === null) {
		return { providerId: provider.providerId, status: "none" };
	}
	return { providerId: provider.providerId, status: "loading" };
};

export const isProviderOptionsRequestCurrent = (
	state: ProviderOptionsState,
	providerId: SandboxProviderId,
	requestId: number,
	currentRequestId: number,
) =>
	state.status === "loading" && state.providerId === providerId && requestId === currentRequestId;

export const applyProviderOptionsResponse = (
	state: ProviderOptionsState,
	response: SearchProviderOptionsResponse,
): ProviderOptionsState => {
	if (state.status !== "loading") {
		return state;
	}
	if (response.schema === null) {
		return { providerId: state.providerId, status: "none" };
	}
	return {
		status: "ready",
		schema: response.schema,
		providerId: state.providerId,
	};
};

export const applyProviderOptionsFailure = (
	state: ProviderOptionsState,
	cause: unknown,
): ProviderOptionsState =>
	state.status === "loading" ? { cause, providerId: state.providerId, status: "failed" } : state;
