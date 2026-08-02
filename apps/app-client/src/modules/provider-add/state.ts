import type { EntityDefinition } from "@ryot/contract/modules/definitions/schemas";
import { decodeProviderEntityLinksResponse } from "@ryot/ryotql-recipes/provider-entity-links";
import {
	decodeProviderSearchResponse,
	type ProviderSearchSummary,
} from "@ryot/ryotql-recipes/provider-search";
import { Match, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { selectAddableDefinitions } from "./flow-state";

type ProviderAddError = {
	readonly title: string;
	readonly detail: string;
};

export type EntityDefinitionsState =
	| { readonly status: "loading" }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly definitions: readonly EntityDefinition[] };

type ProviderSummariesState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly providers: readonly ProviderSearchSummary[] };

type ProviderEntityLinksState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: unknown }
	| { readonly status: "ready"; readonly externalIds: ReadonlySet<string> };

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

export const mapEntityDefinitions = (
	result: AsyncResult.AsyncResult<readonly EntityDefinition[], unknown>,
): EntityDefinitionsState => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause };
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	return { status: "ready", definitions: selectAddableDefinitions(result.value) };
};

export const mapProviderSummaries = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
): ProviderSummariesState => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause };
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	const decoded = decodeProviderSearchResponse(result.value);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure };
	}
	return { status: "ready", providers: decoded.success.items };
};

export const mapProviderEntityLinks = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
): ProviderEntityLinksState => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause };
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	const decoded = decodeProviderEntityLinksResponse(result.value);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure };
	}
	return {
		status: "ready",
		externalIds: new Set(decoded.success.map((link) => link.externalId)),
	};
};
