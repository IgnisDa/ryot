import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import {
	appendSavedViewPage,
	materializeSavedViewData,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
	type SavedViewResultState,
} from "./state";
import type { SavedViewLayout } from "./storage";

export type SavedViewOperationToken = {
	readonly identity: string;
	readonly generation: number;
	readonly layout: SavedViewLayout;
};

export const isSavedViewRequestActiveFor = (
	token: SavedViewOperationToken | undefined,
	identity: string,
	layout: SavedViewLayout,
) => token?.identity === identity && token.layout === layout;

export type SavedViewRequestFailure = {
	readonly cause: unknown;
	readonly status: "transport-error" | "malformed";
};

type SavedViewOperation = {
	readonly token: SavedViewOperationToken;
	readonly phase: "initial" | "load-more" | "refresh";
};

type SavedViewLayoutState = {
	readonly data: SavedViewNormalizedState;
	readonly failure: SavedViewRequestFailure | undefined;
	readonly operation: SavedViewOperation | undefined;
};

export type SavedViewControllerState = {
	readonly identity: string;
	readonly generation: number;
	readonly pendingRefresh: boolean;
	readonly retryRefresh: boolean;
	readonly activeLayout: SavedViewLayout;
	readonly layouts: Partial<Record<SavedViewLayout, SavedViewLayoutState>>;
};

export type SavedViewControllerEvent =
	| {
			readonly type: "identity-changed";
			readonly identity: string;
			readonly layout: SavedViewLayout;
	  }
	| { readonly type: "layout-changed"; readonly layout: SavedViewLayout }
	| { readonly type: "refresh-requested" }
	| { readonly type: "refresh-retry-elapsed" }
	| {
			readonly type: "request-started";
			readonly token: SavedViewOperationToken;
			readonly phase: SavedViewOperation["phase"];
	  }
	| {
			readonly type: "request-succeeded";
			readonly token: SavedViewOperationToken;
			readonly data: SavedViewNormalizedState;
	  }
	| {
			readonly type: "request-failed";
			readonly token: SavedViewOperationToken;
			readonly failure: SavedViewRequestFailure;
	  };

const emptyData = (): SavedViewNormalizedState => ({ itemsById: new Map(), pages: [] });

const emptyLayout = (): SavedViewLayoutState => ({
	data: emptyData(),
	failure: undefined,
	operation: undefined,
});

export const createSavedViewControllerState = (
	identity: string,
	activeLayout: SavedViewLayout,
): SavedViewControllerState => ({
	identity,
	generation: 0,
	pendingRefresh: false,
	retryRefresh: false,
	activeLayout,
	layouts: { [activeLayout]: emptyLayout() },
});

const isSavedViewOperationCurrent = (
	token: SavedViewOperationToken,
	state: Pick<SavedViewControllerState, "identity" | "activeLayout" | "generation">,
) =>
	token.identity === state.identity &&
	token.layout === state.activeLayout &&
	token.generation === state.generation;

const updateLayout = (
	state: SavedViewControllerState,
	layout: SavedViewLayout,
	update: (current: SavedViewLayoutState) => SavedViewLayoutState,
): SavedViewControllerState => ({
	...state,
	layouts: { ...state.layouts, [layout]: update(state.layouts[layout] ?? emptyLayout()) },
});

const isCurrentRequest = (state: SavedViewControllerState, token: SavedViewOperationToken) => {
	const operation = state.layouts[token.layout]?.operation;
	return isSavedViewOperationCurrent(token, state) && operation?.token === token;
};

export const savedViewControllerReducer = (
	state: SavedViewControllerState,
	event: SavedViewControllerEvent,
): SavedViewControllerState => {
	if (event.type === "identity-changed") {
		return event.identity === state.identity
			? state
			: createSavedViewControllerState(event.identity, event.layout);
	}
	if (event.type === "layout-changed") {
		if (event.layout === state.activeLayout) {
			return state;
		}
		const layouts = Object.fromEntries(
			Object.entries(state.layouts).map(([layout, current]) => [
				layout,
				{ ...current, operation: undefined },
			]),
		) as SavedViewControllerState["layouts"];
		return {
			...state,
			pendingRefresh: false,
			retryRefresh: false,
			layouts: { ...layouts, [event.layout]: layouts[event.layout] ?? emptyLayout() },
			generation: state.generation + 1,
			activeLayout: event.layout,
		};
	}
	if (event.type === "refresh-requested") {
		return state.pendingRefresh ? state : { ...state, pendingRefresh: true };
	}
	if (event.type === "refresh-retry-elapsed") {
		return { ...state, retryRefresh: false, pendingRefresh: true };
	}
	if (event.type === "request-started") {
		if (
			event.token.identity !== state.identity ||
			event.token.layout !== state.activeLayout ||
			event.token.generation <= state.generation
		) {
			return state;
		}
		return updateLayout(
			{
				...state,
				generation: event.token.generation,
				retryRefresh: false,
				pendingRefresh: event.phase === "refresh" ? false : state.pendingRefresh,
			},
			event.token.layout,
			(current) => ({
				...current,
				failure: undefined,
				operation: { token: event.token, phase: event.phase },
			}),
		);
	}
	if (event.type === "request-succeeded") {
		if (!isCurrentRequest(state, event.token)) {
			return state;
		}
		return updateLayout({ ...state, retryRefresh: false }, event.token.layout, (current) => ({
			...current,
			data: event.data,
			failure: undefined,
			operation: undefined,
		}));
	}
	if (!isCurrentRequest(state, event.token)) {
		return state;
	}
	const phase = state.layouts[event.token.layout]?.operation?.phase;
	return updateLayout(
		{
			...state,
			retryRefresh: phase === "refresh",
			pendingRefresh: phase === "initial" ? false : state.pendingRefresh,
		},
		event.token.layout,
		(current) => ({
			...current,
			failure: event.failure,
			operation: undefined,
		}),
	);
};

export const savedViewControllerResult = (
	state: SavedViewControllerState,
): SavedViewResultState => {
	const current = state.layouts[state.activeLayout] ?? emptyLayout();
	if (current.data.pages.length > 0) {
		return materializeSavedViewData(current.data, state.activeLayout);
	}
	return current.failure ?? { status: "loading" };
};

export const isSavedViewLoadingMore = (state: SavedViewControllerState) =>
	state.layouts[state.activeLayout]?.operation?.phase === "load-more";

export const canRefreshSavedView = (state: SavedViewControllerState) => {
	const current = state.layouts[state.activeLayout];
	return state.pendingRefresh && !!current && current.data.pages.length > 0 && !current.operation;
};

export const executeSavedViewRequest = (input: {
	readonly queryDocument: RyotQLDocument;
	readonly execute: (queryDocument: RyotQLDocument) => Effect.Effect<unknown, unknown>;
	readonly decode: (
		response: unknown,
	) => Effect.Effect<SavedViewReadyState, SavedViewRequestFailure>;
}) =>
	input.execute(input.queryDocument).pipe(
		Effect.mapError((cause): SavedViewRequestFailure => ({ cause, status: "transport-error" })),
		Effect.flatMap(input.decode),
	);

export const withSavedViewCursor = (queryDocument: RyotQLDocument, after: string) => {
	const [queryName, query] = Object.entries(queryDocument.queries)[0];
	if (query.output.type !== "rows") {
		return queryDocument;
	}
	return {
		...queryDocument,
		queries: {
			...queryDocument.queries,
			[queryName]: {
				...query,
				output: {
					...query.output,
					pagination: { ...query.output.pagination, after },
				},
			},
		},
	};
};

export const fetchSavedViewPages = (input: {
	readonly pagesToLoad: number;
	readonly queryDocument: RyotQLDocument;
	readonly initialData?: SavedViewNormalizedState;
	readonly execute: (queryDocument: RyotQLDocument) => Effect.Effect<unknown, unknown>;
	readonly decode: (
		response: unknown,
	) => Effect.Effect<SavedViewReadyState, SavedViewRequestFailure>;
}) =>
	Effect.gen(function* () {
		let queryDocument = input.queryDocument;
		let data = input.initialData ?? emptyData();
		for (let index = 0; index < input.pagesToLoad; index += 1) {
			const decoded = yield* executeSavedViewRequest({ ...input, queryDocument });
			data = appendSavedViewPage(
				data,
				{ queryDocument, entityIds: decoded.entityIds, pageInfo: decoded.data.pageInfo },
				decoded.data.items,
			);
			const cursor = decoded.data.pageInfo.nextCursor;
			if (!decoded.data.pageInfo.hasMore || !cursor) {
				break;
			}
			queryDocument = withSavedViewCursor(input.queryDocument, cursor);
		}
		return data;
	});
