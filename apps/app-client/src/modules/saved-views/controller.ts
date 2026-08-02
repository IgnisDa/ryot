import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { withSavedViewCursor } from "./atom-requests";
import type { SavedViewCardItem, SavedViewTableItem } from "./display-data";
import type { SavedViewLayout } from "./saved-view-layout-selector";
import {
	appendSavedViewPage,
	materializeSavedViewData,
	patchSavedViewItems,
	type SavedViewNormalizedState,
	type SavedViewReadyState,
	type SavedViewResultState,
} from "./state";

type SavedViewItem = SavedViewCardItem | SavedViewTableItem;

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
	readonly phase: "initial" | "load-more" | "structural";
};

type SavedViewLayoutState = {
	readonly data: SavedViewNormalizedState;
	readonly manual: boolean;
	readonly failure: SavedViewRequestFailure | undefined;
	readonly operation: SavedViewOperation | undefined;
};

export type SavedViewControllerState = {
	readonly identity: string;
	readonly generation: number;
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
	| { readonly type: "manual-started"; readonly token: Omit<SavedViewOperationToken, "generation"> }
	| { readonly type: "manual-ended"; readonly token: Omit<SavedViewOperationToken, "generation"> }
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
	  }
	| {
			readonly type: "hydration-succeeded";
			readonly token: SavedViewOperationToken;
			readonly entityIds: readonly string[];
			readonly items: readonly SavedViewItem[];
	  };

const emptyData = (): SavedViewNormalizedState => ({ itemsById: new Map(), pages: [] });

const emptyLayout = (): SavedViewLayoutState => ({
	manual: false,
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
	activeLayout,
	layouts: { [activeLayout]: emptyLayout() },
});

export const isSavedViewOperationCurrent = (
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
				{ ...current, manual: false, operation: undefined },
			]),
		) as SavedViewControllerState["layouts"];
		return {
			...state,
			layouts: { ...layouts, [event.layout]: layouts[event.layout] ?? emptyLayout() },
			generation: state.generation + 1,
			activeLayout: event.layout,
		};
	}
	if (event.type === "manual-started" || event.type === "manual-ended") {
		if (event.token.identity !== state.identity || event.token.layout !== state.activeLayout) {
			return state;
		}
		return updateLayout(state, event.token.layout, (current) => ({
			...current,
			manual: event.type === "manual-started",
		}));
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
			{ ...state, generation: event.token.generation },
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
		return updateLayout(state, event.token.layout, (current) => ({
			...current,
			data: event.data,
			manual: false,
			failure: undefined,
			operation: undefined,
		}));
	}
	if (event.type === "request-failed") {
		if (!isCurrentRequest(state, event.token)) {
			return state;
		}
		return updateLayout(state, event.token.layout, (current) => ({
			...current,
			manual: false,
			failure: event.failure,
			operation: undefined,
		}));
	}
	if (!isSavedViewOperationCurrent(event.token, state)) {
		return state;
	}
	return updateLayout(state, event.token.layout, (current) => {
		const loaded = new Set(current.data.pages.flatMap((page) => page.entityIds));
		const requested = new Set(event.entityIds);
		return {
			...current,
			data: patchSavedViewItems(
				current.data,
				event.items.filter((item) => loaded.has(item.entityId) && requested.has(item.entityId)),
			),
		};
	});
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
