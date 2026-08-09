import type {
	ListedIntegration,
	ListedIntegrationProvider,
} from "@ryot/contract/modules/integrations/schemas";
import type { ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";
import type { IntegrationList, IntegrationSummary } from "@ryot/ryotql-recipes/integrations";
import type { AsyncResult } from "effect/unstable/reactivity";

import { requestFailureCopy, type RequestFailureState } from "@/api/request-failure";
import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";

export type IntegrationListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly integrations: readonly IntegrationSummary[];
	  }
>;

export type IntegrationProviderListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| { readonly status: "ready"; readonly providers: readonly ListedIntegrationProvider[] }
>;

export type IntegrationDetailState = MappedRyotQLResultState<
	| { readonly status: "not-found" }
	| { readonly status: "ready"; readonly integration: ListedIntegration }
>;

export type IntegrationRunListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| { readonly status: "ready"; readonly runs: readonly ImportRunSummary[] }
>;

/** Provider slugs are only unique within their plugin, so display names are keyed by both. */
export const integrationProviderKey = (input: {
	readonly provider: string;
	readonly pluginSlug: string;
}) => `${input.pluginSlug}:${input.provider}`;

export const mapIntegrationList = (
	result: AsyncResult.AsyncResult<IntegrationList, unknown>,
): IntegrationListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.items.length === 0
		? { status: "empty" }
		: {
				status: "ready",
				integrations: state.value.items,
				hasMore: state.value.pageInfo.hasMore,
			};
};

export const mapIntegrationProviderList = (
	result: AsyncResult.AsyncResult<readonly ListedIntegrationProvider[], unknown>,
): IntegrationProviderListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.length === 0
		? { status: "empty" }
		: { status: "ready", providers: state.value };
};

export const mapIntegrationDetail = (
	result: AsyncResult.AsyncResult<ListedIntegration, unknown>,
): IntegrationDetailState => {
	const state = classifyRyotQLResult(result);
	return state.status === "ready" ? { status: "ready", integration: state.value } : state;
};

export const mapIntegrationRunList = (
	result: AsyncResult.AsyncResult<{ readonly items: readonly ImportRunSummary[] }, unknown>,
): IntegrationRunListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.items.length === 0
		? { status: "empty" }
		: { status: "ready", runs: state.value.items };
};

export const mapIntegrationProviderNames = (
	result: AsyncResult.AsyncResult<readonly ListedIntegrationProvider[], unknown>,
): ReadonlyMap<string, string> => {
	const state = classifyRyotQLResult(result);
	return state.status === "ready"
		? new Map(
				state.value.map((provider) => [
					integrationProviderKey({ provider: provider.slug, pluginSlug: provider.pluginSlug }),
					provider.name,
				]),
			)
		: new Map();
};

export const integrationListError = (state: RequestFailureState) =>
	requestFailureCopy(state, {
		subject: "Your integrations",
		title: "Unable to load integrations",
	});

export const integrationDetailError = (state: RequestFailureState) =>
	requestFailureCopy(state, {
		subject: "This integration",
		title: "Unable to load this integration",
	});
