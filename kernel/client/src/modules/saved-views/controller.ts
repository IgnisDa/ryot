import type { FieldSelection, RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { and, contains, literal } from "@ryot/ryotql";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Effect } from "effect";

import { RyotQLMalformedResultError } from "@/api/ryotql";

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
	readonly operation: SavedViewOperation | undefined;
	readonly failure: SavedViewRequestFailure | undefined;
};

type SavedViewVisibleData = {
	readonly identity: string;
	readonly layout: SavedViewLayout;
	readonly queryDocument: RyotQLDocument;
	readonly data: SavedViewNormalizedState;
};

export type SavedViewControllerState = {
	readonly identity: string;
	readonly generation: number;
	readonly retryRefresh: boolean;
	readonly pendingRefresh: boolean;
	readonly activeLayout: SavedViewLayout;
	readonly visible: SavedViewVisibleData | undefined;
	readonly layouts: Partial<Record<SavedViewLayout, SavedViewLayoutState>>;
};

export type SavedViewControllerEvent =
	| {
			readonly identity: string;
			readonly layout: SavedViewLayout;
			readonly type: "identity-changed";
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

const latestQueryDocument = (data: SavedViewNormalizedState) => {
	const page = data.pages.at(-1);
	if (!page) {
		throw new TypeError("Saved-view data requires at least one page");
	}
	return page.queryDocument;
};

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
	activeLayout,
	generation: 0,
	visible: undefined,
	retryRefresh: false,
	pendingRefresh: false,
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
		if (event.identity === state.identity) {
			return state;
		}
		return {
			...createSavedViewControllerState(event.identity, event.layout),
			visible: state.visible,
		};
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
		const nextLayout = layouts[event.layout] ?? emptyLayout();
		const nextData = nextLayout.data.pages.length > 0 ? nextLayout.data : undefined;
		return {
			...state,
			retryRefresh: false,
			pendingRefresh: false,
			activeLayout: event.layout,
			generation: state.generation + 1,
			layouts: { ...layouts, [event.layout]: nextLayout },
			visible:
				nextData === undefined
					? state.visible
					: {
							data: nextData,
							layout: event.layout,
							identity: state.identity,
							queryDocument: latestQueryDocument(nextData),
						},
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
				retryRefresh: false,
				generation: event.token.generation,
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
		return updateLayout(
			{
				...state,
				retryRefresh: false,
				visible: {
					data: event.data,
					identity: state.identity,
					layout: event.token.layout,
					queryDocument: latestQueryDocument(event.data),
				},
			},
			event.token.layout,
			(current) => ({ ...current, data: event.data, failure: undefined, operation: undefined }),
		);
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
		(current) => ({ ...current, operation: undefined, failure: event.failure }),
	);
};

export const savedViewControllerResult = (
	state: SavedViewControllerState,
): SavedViewResultState => {
	const active = state.layouts[state.activeLayout] ?? emptyLayout();
	if (active.data.pages.length === 0 && active.failure) {
		return active.failure;
	}
	if (state.visible) {
		return materializeSavedViewData(state.visible.data, state.visible.layout);
	}
	return active.failure ?? { status: "loading" };
};

export const savedViewControllerQueryDocument = (state: SavedViewControllerState) =>
	state.visible?.queryDocument;

export const isSavedViewLayoutChanging = (state: SavedViewControllerState) =>
	state.visible !== undefined && state.visible.layout !== state.activeLayout;

export const isSavedViewSearching = (state: SavedViewControllerState) =>
	state.visible !== undefined &&
	state.visible.identity !== state.identity &&
	state.visible.layout === state.activeLayout;

export const isSavedViewLoadingMore = (state: SavedViewControllerState) =>
	state.layouts[state.activeLayout]?.operation?.phase === "load-more";

export const canRefreshSavedView = (state: SavedViewControllerState) => {
	const current = state.layouts[state.activeLayout];
	return state.pendingRefresh && !!current && current.data.pages.length > 0 && !current.operation;
};

export const executeSavedViewRequest = (input: {
	readonly queryDocument: RyotQLDocument;
	readonly execute: (queryDocument: RyotQLDocument) => Effect.Effect<SavedViewReadyState, unknown>;
}) =>
	input.execute(input.queryDocument).pipe(
		Effect.mapError(
			(cause): SavedViewRequestFailure => ({
				cause,
				status: cause instanceof RyotQLMalformedResultError ? "malformed" : "transport-error",
			}),
		),
	);

type SavedViewLayoutDefinition = SavedViewRecord["layouts"][keyof SavedViewRecord["layouts"]];

export const withSavedViewSearch = (
	queryDocument: RyotQLDocument,
	layout: SavedViewLayoutDefinition,
	queryString: string,
) => {
	const tokens = queryString
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean);
	if (tokens.length === 0) {
		return queryDocument;
	}

	let primaryField: string | undefined;
	if ("columns" in layout) {
		primaryField = layout.columns.at(0)?.field;
	} else {
		primaryField = layout.titleField;
	}
	if (typeof primaryField !== "string") {
		return queryDocument;
	}

	const queryEntry = Object.entries(queryDocument.queries).at(0);
	if (!queryEntry) {
		return queryDocument;
	}
	const [queryName, query] = queryEntry;
	if (query.output.type !== "rows") {
		return queryDocument;
	}
	const primarySelection = query.output.fields.find(
		(selection): selection is FieldSelection =>
			"key" in selection && "expr" in selection && selection.key === primaryField,
	);
	if (!primarySelection) {
		return queryDocument;
	}

	const searchPredicate = and(
		...tokens.map((token) => contains(primarySelection.expr, literal(token))),
	);
	const pagination = { ...query.output.pagination };
	delete pagination.after;
	return {
		...queryDocument,
		queries: {
			...queryDocument.queries,
			[queryName]: {
				...query,
				output: { ...query.output, pagination },
				where: query.where ? and(query.where, searchPredicate) : searchPredicate,
			},
		},
	};
};

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
				output: { ...query.output, pagination: { ...query.output.pagination, after } },
			},
		},
	};
};

export const fetchSavedViewPages = (input: {
	readonly pagesToLoad: number;
	readonly queryDocument: RyotQLDocument;
	readonly initialData?: SavedViewNormalizedState;
	readonly execute: (queryDocument: RyotQLDocument) => Effect.Effect<SavedViewReadyState, unknown>;
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
