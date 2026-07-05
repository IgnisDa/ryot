import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewLayoutName } from "@ryot-app/contract/modules/saved-views/schemas";
import type {
	SavedViewCardResultItem,
	SavedViewResult,
	SavedViewTableResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";

export type SavedViewItem = SavedViewCardResultItem | SavedViewTableResultItem;
export type SavedViewData = {
	readonly pages: number;
	readonly queryDocument: RyotQLDocument;
	readonly items: readonly SavedViewItem[];
	readonly managedUrls: ReadonlyMap<string, string>;
	readonly pageInfo: SavedViewResult<SavedViewItem>["pageInfo"];
};

export type SavedViewRequestToken = {
	readonly identity: string;
	readonly generation: number;
	readonly layout: SavedViewLayoutName;
};

type SavedViewOperation = {
	readonly token: SavedViewRequestToken;
	readonly phase: "initial" | "load-more" | "refresh";
};

export type SavedViewControllerState = {
	readonly identity: string;
	readonly failure?: unknown;
	readonly generation: number;
	readonly activeLayout: SavedViewLayoutName;
	readonly operation?: SavedViewOperation | undefined;
	readonly failedPhase?: SavedViewOperation["phase"] | undefined;
	readonly layouts: Partial<Record<SavedViewLayoutName, SavedViewData>>;
	readonly visible?: {
		readonly identity: string;
		readonly data: SavedViewData;
		readonly layout: SavedViewLayoutName;
	};
};

export type SavedViewControllerEvent =
	| { readonly type: "interest-updated" }
	| { readonly type: "identity-changed"; readonly identity: string }
	| { readonly type: "layout-changed"; readonly layout: SavedViewLayoutName }
	| { readonly type: "request-started"; readonly operation: SavedViewOperation }
	| {
			readonly data: SavedViewData;
			readonly type: "request-succeeded";
			readonly token: SavedViewRequestToken;
	  }
	| {
			readonly cause: unknown;
			readonly type: "request-failed";
			readonly token: SavedViewRequestToken;
	  };

export const createSavedViewController = (input: {
	readonly identity: string;
	readonly data: SavedViewData;
	readonly layout: SavedViewLayoutName;
}): SavedViewControllerState => ({
	generation: 0,
	failure: undefined,
	operation: undefined,
	failedPhase: undefined,
	identity: input.identity,
	activeLayout: input.layout,
	layouts: { [input.layout]: input.data },
	visible: { data: input.data, identity: input.identity, layout: input.layout },
});

const isCurrent = (state: SavedViewControllerState, token: SavedViewRequestToken) =>
	state.identity === token.identity &&
	state.activeLayout === token.layout &&
	state.generation === token.generation &&
	state.operation?.token === token;

export const savedViewControllerReducer = (
	state: SavedViewControllerState,
	event: SavedViewControllerEvent,
): SavedViewControllerState => {
	if (event.type === "interest-updated") {
		const current = state.layouts[state.activeLayout];
		return { ...state, layouts: current === undefined ? {} : { [state.activeLayout]: current } };
	}
	if (event.type === "identity-changed") {
		return event.identity === state.identity
			? state
			: {
					...state,
					layouts: {},
					failure: undefined,
					operation: undefined,
					failedPhase: undefined,
					identity: event.identity,
					generation: state.generation + 1,
				};
	}
	if (event.type === "layout-changed") {
		if (event.layout === state.activeLayout) {
			return state;
		}
		const cached = state.layouts[event.layout];
		return {
			...state,
			failure: undefined,
			operation: undefined,
			failedPhase: undefined,
			activeLayout: event.layout,
			generation: state.generation + 1,
			visible:
				cached === undefined
					? state.visible
					: { data: cached, identity: state.identity, layout: event.layout },
		};
	}
	if (event.type === "request-started") {
		if (
			event.operation.token.identity !== state.identity ||
			event.operation.token.layout !== state.activeLayout ||
			event.operation.token.generation < state.generation
		) {
			return state;
		}
		return {
			...state,
			failure: undefined,
			failedPhase: undefined,
			operation: event.operation,
			generation: event.operation.token.generation,
		};
	}
	if (!isCurrent(state, event.token)) {
		return state;
	}
	if (event.type === "request-failed") {
		return {
			...state,
			failure: event.cause,
			operation: undefined,
			failedPhase: state.operation?.phase,
		};
	}
	return {
		...state,
		failure: undefined,
		operation: undefined,
		failedPhase: undefined,
		layouts: { ...state.layouts, [event.token.layout]: event.data },
		visible: { data: event.data, identity: state.identity, layout: event.token.layout },
	};
};

export const appendSavedViewPage = (
	current: SavedViewData | undefined,
	page: SavedViewResult<SavedViewItem>,
	queryDocument: RyotQLDocument,
	managedUrls: ReadonlyMap<string, string>,
): SavedViewData => {
	const itemsById = new Map(current?.items.map((item) => [item.entityId, item]));
	const entityIds = current?.items.map((item) => item.entityId) ?? [];
	const seen = new Set(entityIds);
	for (const item of page.items) {
		itemsById.set(item.entityId, item);
		if (!seen.has(item.entityId)) {
			seen.add(item.entityId);
			entityIds.push(item.entityId);
		}
	}
	return {
		managedUrls,
		queryDocument,
		pageInfo: page.pageInfo,
		pages: (current?.pages ?? 0) + 1,
		items: entityIds.flatMap((entityId) => {
			const item = itemsById.get(entityId);
			return item === undefined ? [] : [item];
		}),
	};
};
