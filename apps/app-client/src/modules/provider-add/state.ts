import type { EntityId } from "@ryot/contract/schema/brands";
import type { ProviderEntityLinksResult } from "@ryot/ryotql-recipes/provider-entity-links";
import type { ProviderSearchResult } from "@ryot/ryotql-recipes/provider-search";
import { Match } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { isRyotQLMalformedResultCause } from "@/api/ryotql";

export type ProviderSearchSummary = ProviderSearchResult["items"][number];

type ProviderAddError = {
	readonly title: string;
	readonly detail: string;
};

type ProviderSummariesState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly providers: readonly ProviderSearchSummary[] };

type ProviderEntityLinksState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly entityIds: ReadonlyMap<string, EntityId> };

export const providerAddError = (state: {
	readonly status: "transport-error" | "malformed";
}): ProviderAddError =>
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
	if (AsyncResult.isFailure(result)) {
		return {
			cause: result.cause,
			status: isRyotQLMalformedResultCause(result.cause) ? "malformed" : "transport-error",
		};
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	return { status: "ready", providers: result.value.items };
};

export const mapProviderEntityLinks = (
	result: AsyncResult.AsyncResult<ProviderEntityLinksResult, unknown>,
): ProviderEntityLinksState => {
	if (AsyncResult.isFailure(result)) {
		return {
			cause: result.cause,
			status: isRyotQLMalformedResultCause(result.cause) ? "malformed" : "transport-error",
		};
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	return {
		status: "ready",
		entityIds: new Map(result.value.map((link) => [link.externalId, link.entityId])),
	};
};
