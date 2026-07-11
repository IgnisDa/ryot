import type { SearchProviderOptionsResponse } from "@ryot-app/contract/modules/provider-entities/schemas";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import type { ProviderSearchSummary } from "#/modules/provider-add/service";

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
		return { status: "none", providerId: undefined };
	}
	if (provider.searchOptionsSchema === null) {
		return { status: "none", providerId: provider.providerId };
	}
	return { status: "loading", providerId: provider.providerId };
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
		return { status: "none", providerId: state.providerId };
	}
	return { status: "ready", schema: response.schema, providerId: state.providerId };
};

export const applyProviderOptionsFailure = (
	state: ProviderOptionsState,
	cause: unknown,
): ProviderOptionsState =>
	state.status === "loading" ? { cause, status: "failed", providerId: state.providerId } : state;
