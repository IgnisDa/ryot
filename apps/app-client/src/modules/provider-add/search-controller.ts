import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot/contract/modules/provider-entities/schemas";
import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";
import type { SandboxProviderId } from "@ryot/contract/schema/brands";
import { Match } from "effect";

const PROVIDER_SEARCH_PAGE_SIZE = 20;

export type ProviderSearchItem = SearchProviderEntitiesResponse["items"][number];

type ProviderSearchStatus = "idle" | "loading" | "loading-more" | "failed" | "ready";

export type ProviderSearchOperation = {
	readonly page: number;
	readonly token: number;
	readonly phase: "initial" | "load-more";
};

export type ProviderSearchState = {
	readonly query: string;
	readonly generation: number;
	readonly requestToken: number;
	readonly status: ProviderSearchStatus;
	readonly items: readonly ProviderSearchItem[];
	readonly nextPage: number | null | undefined;
	readonly operation: ProviderSearchOperation | undefined;
};

export type ProviderSearchEvent =
	| { readonly type: "options-changed" }
	| { readonly type: "provider-changed" }
	| { readonly type: "search-requested" }
	| { readonly type: "next-page-requested" }
	| { readonly type: "query-changed"; readonly query: string }
	| {
			readonly type: "request-failed";
			readonly token: number;
	  }
	| {
			readonly token: number;
			readonly type: "response-received";
			readonly response: SearchProviderEntitiesResponse;
	  };

export const createProviderSearchState = (): ProviderSearchState => ({
	items: [],
	query: "",
	generation: 0,
	status: "idle",
	requestToken: 0,
	nextPage: undefined,
	operation: undefined,
});

const clearProviderSearch = (state: ProviderSearchState, query: string): ProviderSearchState => ({
	...createProviderSearchState(),
	query,
	generation: state.generation + 1,
	requestToken: state.requestToken,
});

const startProviderSearch = (state: ProviderSearchState): ProviderSearchState => {
	if (state.query.trim() === "") {
		return clearProviderSearch(state, state.query);
	}
	const token = state.requestToken + 1;
	return {
		...state,
		status: "loading",
		requestToken: token,
		operation: { token, page: 1, phase: "initial" },
	};
};

const startProviderSearchNextPage = (state: ProviderSearchState): ProviderSearchState => {
	if (state.operation !== undefined || state.nextPage === null || state.nextPage === undefined) {
		return state;
	}
	const token = state.requestToken + 1;
	return {
		...state,
		requestToken: token,
		status: "loading-more",
		operation: { token, page: state.nextPage, phase: "load-more" },
	};
};

const applyProviderSearchResponse = (
	state: ProviderSearchState,
	event: { readonly token: number; readonly response: SearchProviderEntitiesResponse },
): ProviderSearchState => {
	const operation = state.operation;
	if (operation?.token !== event.token) {
		return state;
	}
	return {
		...state,
		status: "ready",
		operation: undefined,
		nextPage: event.response.details?.nextPage,
		items:
			operation.phase === "initial"
				? event.response.items
				: [...state.items, ...event.response.items],
	};
};

const applyProviderSearchFailure = (
	state: ProviderSearchState,
	event: { readonly token: number },
): ProviderSearchState =>
	state.operation?.token !== event.token
		? state
		: { ...state, status: "failed", operation: undefined };

export const providerSearchReducer = (
	state: ProviderSearchState,
	event: ProviderSearchEvent,
): ProviderSearchState =>
	Match.value(event).pipe(
		Match.when({ type: "options-changed" }, () => clearProviderSearch(state, state.query)),
		Match.when({ type: "provider-changed" }, () => clearProviderSearch(state, state.query)),
		Match.when({ type: "search-requested" }, () => startProviderSearch(state)),
		Match.when({ type: "next-page-requested" }, () => startProviderSearchNextPage(state)),
		Match.when({ type: "query-changed" }, (current) =>
			current.query === state.query ? state : clearProviderSearch(state, current.query),
		),
		Match.when({ type: "response-received" }, (current) =>
			applyProviderSearchResponse(state, current),
		),
		Match.when({ type: "request-failed" }, (current) => applyProviderSearchFailure(state, current)),
		Match.exhaustive,
	);

export const hasMoreProviderSearchResults = (state: ProviderSearchState) =>
	state.nextPage !== null && state.nextPage !== undefined;

export const buildSearchPayload = (input: {
	readonly page: number;
	readonly query: string;
	readonly providerId: SandboxProviderId;
	readonly options?: Readonly<Record<string, JsonValue>> | undefined;
}): SearchProviderEntitiesBody => {
	const payload = {
		page: input.page,
		query: input.query,
		providerId: input.providerId,
		pageSize: PROVIDER_SEARCH_PAGE_SIZE,
	};
	return input.options === undefined || Object.keys(input.options).length === 0
		? payload
		: { ...payload, options: { ...input.options } };
};
