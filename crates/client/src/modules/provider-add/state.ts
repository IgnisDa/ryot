import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { ProviderEntityLinksResult } from "@ryot-app/ryotql-recipes/provider-entity-links";
import type { ProviderSearchResult } from "@ryot-app/ryotql-recipes/provider-search";
import { Match } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";

export type ProviderSearchSummary = ProviderSearchResult["items"][number];

type ProviderSummariesState = MappedRyotQLResultState<{
	readonly status: "ready";
	readonly providers: readonly ProviderSearchSummary[];
}>;

type ProviderEntityLinksState = MappedRyotQLResultState<{
	readonly status: "ready";
	readonly entityIds: ReadonlyMap<string, EntityId>;
}>;

type ProviderAddFailure = Pick<
	Extract<ProviderSummariesState, { status: "transport-error" | "malformed" }>,
	"status"
>;

export const providerAddError = (state: ProviderAddFailure) =>
	Match.value(state.status).pipe(
		Match.when("transport-error", () => ({
			title: "Unable to reach the server",
			detail: "The server could not be reached. Check your connection and try again.",
		})),
		Match.when("malformed", () => ({
			title: "Unable to display results",
			detail: "The server returned data that could not be displayed. Try again later.",
		})),
		Match.exhaustive,
	);

export const mapProviderSummaries = (
	result: AsyncResult.AsyncResult<ProviderSearchResult, unknown>,
): ProviderSummariesState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return { status: "ready", providers: state.value.items };
};

export const mapProviderEntityLinks = (
	result: AsyncResult.AsyncResult<ProviderEntityLinksResult, unknown>,
): ProviderEntityLinksState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return {
		status: "ready",
		entityIds: new Map(state.value.map((link) => [link.externalId, link.entityId])),
	};
};
