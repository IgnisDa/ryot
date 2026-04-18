import { expect, it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { SavedViewRecord } from "@ryot/ryotql-recipes/saved-view-records";
import { Effect } from "effect";

import {
	canRefreshSavedView,
	createSavedViewControllerState,
	fetchSavedViewPages,
	savedViewControllerReducer,
	savedViewControllerResult,
	isSavedViewRequestActiveFor,
	type SavedViewOperationToken,
	withSavedViewSearch,
	withSavedViewCursor,
} from "./controller";
import type { SavedViewCardItem } from "./display-data";
import type { SavedViewReadyState } from "./state";

const baseQuery = {
	queries: {
		view: {
			from: { alias: "entity", table: "entity" },
			output: {
				type: "rows",
				pagination: { limit: 2 },
				fields: [{ key: "entityId", expr: { field: "id", type: "column", tableAlias: "entity" } }],
				orderBy: [
					{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "entity" } },
				],
			},
		},
	},
} satisfies RyotQLDocument;

const searchQuery = {
	queries: {
		view: {
			from: { alias: "entity", table: "entity" },
			output: {
				type: "rows",
				pagination: { after: "cursor", limit: 2 },
				orderBy: [
					{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "entity" } },
				],
				fields: [
					{ key: "entityId", expr: { field: "id", type: "column", tableAlias: "entity" } },
					{ key: "title", expr: { field: "name", type: "column", tableAlias: "entity" } },
				],
			},
		},
	},
} satisfies RyotQLDocument;

const cardLayout = {
	imageField: null,
	calloutField: null,
	titleField: "title",
	overlineField: null,
	entityIdField: "entityId",
	primaryMetadataField: null,
	queryDocument: searchQuery,
	secondaryMetadataField: null,
} satisfies SavedViewRecord["layouts"]["grid"];

const tableLayout = {
	imageField: null,
	entityIdField: "entityId",
	queryDocument: searchQuery,
	columns: [{ field: "title", label: "Title" }],
} satisfies SavedViewRecord["layouts"]["table"];

const card = (entityId: string, title = entityId): SavedViewCardItem => ({
	title,
	entityId,
	image: { type: "missing" },
});

const ready = (
	items: readonly SavedViewCardItem[],
	nextCursor: string | null,
): SavedViewReadyState => ({
	assets: [],
	layout: "grid",
	status: "ready",
	entityIds: items.map((item) => item.entityId),
	data: { items, pageInfo: { limit: 2, hasMore: nextCursor !== null, nextCursor } },
});

const page = (
	entityIds: readonly string[],
	nextCursor: string | null,
	queryDocument: RyotQLDocument = baseQuery,
) => ({
	entityIds,
	queryDocument,
	pageInfo: { limit: 2, hasMore: nextCursor !== null, nextCursor },
});

const token = (
	identity: string,
	layout: SavedViewOperationToken["layout"] = "grid",
	generation = 1,
): SavedViewOperationToken => ({ identity, layout, generation });

it("splits saved-view search terms and combines them with AND", () => {
	const searched = withSavedViewSearch(
		cardLayout.queryDocument,
		cardLayout,
		"  alpha_beta-gamma  ",
	);

	expect(searched.queries.view.output).toMatchObject({ pagination: { limit: 2 } });
	expect(searched.queries.view.output.type).toBe("rows");
	if (searched.queries.view.output.type !== "rows") {
		throw new Error("Expected rows output");
	}
	expect(searched.queries.view.output.fields).toEqual(
		cardLayout.queryDocument.queries.view.output.fields,
	);
	expect(searched.queries.view.output.pagination).toEqual({ limit: 2 });
	expect(searched.queries.view).toMatchObject({
		where: {
			type: "and",
			predicates: [
				{
					type: "contains",
					right: { type: "literal", value: "alpha" },
					left: { field: "name", type: "column", tableAlias: "entity" },
				},
				{
					type: "contains",
					right: { type: "literal", value: "beta" },
					left: { field: "name", type: "column", tableAlias: "entity" },
				},
				{
					type: "contains",
					right: { type: "literal", value: "gamma" },
					left: { field: "name", type: "column", tableAlias: "entity" },
				},
			],
		},
	});
});

it("composes saved-view search with an existing where predicate", () => {
	const existingWhere = {
		operator: "eq",
		type: "comparison",
		right: { type: "literal", value: "book" },
		left: { field: "entitySchemaSlug", type: "column", tableAlias: "entity" },
	} as const;
	const queryDocument = {
		...searchQuery,
		queries: { view: { ...searchQuery.queries.view, where: existingWhere } },
	} satisfies RyotQLDocument;

	const searched = withSavedViewSearch(queryDocument, cardLayout, "book");

	expect(searched.queries.view.where).toMatchObject({
		type: "and",
		predicates: [existingWhere, { type: "and", predicates: [{ type: "contains" }] }],
	});
});

it("uses the first table column expression for saved-view search", () => {
	const searched = withSavedViewSearch(tableLayout.queryDocument, tableLayout, "first");

	expect(searched.queries.view.where).toMatchObject({
		type: "and",
		predicates: [
			{
				type: "contains",
				right: { type: "literal", value: "first" },
				left: { field: "name", type: "column", tableAlias: "entity" },
			},
		],
	});
	expect(searched.queries.view.output).toMatchObject({ pagination: { limit: 2 } });
});

it("returns the original saved-view document for empty or unmapped searches", () => {
	expect(withSavedViewSearch(searchQuery, cardLayout, "  _-  ")).toBe(searchQuery);
	expect(withSavedViewSearch(searchQuery, { ...cardLayout, titleField: "missing" }, "term")).toBe(
		searchQuery,
	);
	const wildcardDocument = {
		...searchQuery,
		queries: {
			view: {
				...searchQuery.queries.view,
				output: {
					...searchQuery.queries.view.output,
					fields: [{ tableAlias: "entity", type: "wildcard" }],
				},
			},
		},
	} satisfies RyotQLDocument;
	expect(withSavedViewSearch(wildcardDocument, cardLayout, "term")).toBe(wildcardDocument);
});

it.effect("loads pages in order with fresh cursors and deduplicates materialized entities", () =>
	Effect.gen(function* () {
		const documents: RyotQLDocument[] = [];
		const responses = [
			ready([card("entity-1"), card("entity-2")], "fresh-2"),
			ready([card("entity-2", "Updated"), card("entity-3")], null),
		];
		const data = yield* fetchSavedViewPages({
			pagesToLoad: 2,
			queryDocument: baseQuery,
			decode: () => {
				const response = responses.shift();
				return response
					? Effect.succeed(response)
					: Effect.fail({ status: "malformed", cause: new Error("Missing response") });
			},
			execute: (queryDocument) => Effect.sync(() => void documents.push(queryDocument)),
		});

		expect(documents[0]).toBe(baseQuery);
		expect(documents[1]?.queries.view.output).toMatchObject({
			pagination: { after: "fresh-2", limit: 2 },
		});
		expect(data.pages.map((currentPage) => currentPage.entityIds)).toEqual([
			["entity-1", "entity-2"],
			["entity-2", "entity-3"],
		]);
		let state = createSavedViewControllerState("scope:record", "grid");
		const operation = token(state.identity);
		state = savedViewControllerReducer(state, {
			token: operation,
			phase: "refresh",
			type: "request-started",
		});
		state = savedViewControllerReducer(state, {
			data,
			token: operation,
			type: "request-succeeded",
		});
		expect(savedViewControllerResult(state)).toMatchObject({
			status: "ready",
			entityIds: ["entity-1", "entity-2", "entity-3"],
			data: { items: [{ title: "entity-1" }, { title: "Updated" }, { title: "entity-3" }] },
		});
	}),
);

it.effect("appends load-more and fully replaces an already loaded multi-page range", () =>
	Effect.gen(function* () {
		const documents: RyotQLDocument[] = [];
		const loaded = {
			itemsById: new Map([
				["entity-1", card("entity-1")],
				["entity-2", card("entity-2")],
				["entity-3", card("entity-3")],
			]),
			pages: [
				page(["entity-1", "entity-2"], "cursor-2"),
				page(["entity-2", "entity-3"], "cursor-3"),
			],
		};
		const appended = yield* fetchSavedViewPages({
			initialData: loaded,
			pagesToLoad: 1,
			queryDocument: withSavedViewCursor(baseQuery, "cursor-3"),
			decode: () => Effect.succeed(ready([card("entity-3", "Updated"), card("entity-4")], null)),
			execute: (queryDocument) => Effect.sync(() => void documents.push(queryDocument)),
		});
		expect(documents[0]?.queries.view.output).toMatchObject({
			pagination: { after: "cursor-3", limit: 2 },
		});
		expect(appended.pages.map((current) => current.entityIds)).toEqual([
			["entity-1", "entity-2"],
			["entity-2", "entity-3"],
			["entity-3", "entity-4"],
		]);

		let state = createSavedViewControllerState("scope:record", "grid");
		const initial = token(state.identity);
		state = savedViewControllerReducer(state, {
			token: initial,
			type: "request-started",
			phase: "load-more",
		});
		state = savedViewControllerReducer(state, {
			data: appended,
			token: initial,
			type: "request-succeeded",
		});
		expect(savedViewControllerResult(state)).toMatchObject({
			entityIds: ["entity-1", "entity-2", "entity-3", "entity-4"],
			data: { items: [{}, {}, { title: "Updated" }, {}] },
		});

		const responses = [ready([card("entity-5")], "fresh-2"), ready([card("entity-6")], null)];
		const replacement = yield* fetchSavedViewPages({
			pagesToLoad: state.layouts.grid?.data.pages.length ?? 0,
			queryDocument: baseQuery,
			decode: () => {
				const response = responses.shift();
				return response
					? Effect.succeed(response)
					: Effect.fail({ status: "malformed", cause: new Error("Missing response") });
			},
			execute: () => Effect.void,
		});
		const refresh = token(state.identity, "grid", state.generation + 1);
		state = savedViewControllerReducer(state, {
			token: refresh,
			type: "request-started",
			phase: "refresh",
		});
		state = savedViewControllerReducer(state, {
			token: refresh,
			type: "request-succeeded",
			data: replacement,
		});
		expect(state.layouts.grid?.data.pages.map((current) => current.entityIds)).toEqual([
			["entity-5"],
			["entity-6"],
		]);
		expect(savedViewControllerResult(state)).toMatchObject({
			entityIds: ["entity-5", "entity-6"],
		});
	}),
);

it("rejects stale identity and layout completions", () => {
	let identityState = createSavedViewControllerState("server-a:user-a:record", "grid");
	const identityToken = token(identityState.identity);
	identityState = savedViewControllerReducer(identityState, {
		token: identityToken,
		type: "request-started",
		phase: "initial",
	});
	identityState = savedViewControllerReducer(identityState, {
		layout: "grid",
		type: "identity-changed",
		identity: "server-b:user-a:record",
	});
	const afterIdentity = savedViewControllerReducer(identityState, {
		token: identityToken,
		type: "request-succeeded",
		data: { itemsById: new Map(), pages: [] },
	});
	expect(afterIdentity).toBe(identityState);

	let layoutState = createSavedViewControllerState("server:user:record", "grid");
	const layoutToken = token(layoutState.identity);
	layoutState = savedViewControllerReducer(layoutState, {
		token: layoutToken,
		type: "request-started",
		phase: "initial",
	});
	layoutState = savedViewControllerReducer(layoutState, {
		layout: "list",
		type: "layout-changed",
	});
	const afterLayout = savedViewControllerReducer(layoutState, {
		token: layoutToken,
		type: "request-succeeded",
		data: { itemsById: new Map(), pages: [] },
	});
	expect(afterLayout).toBe(layoutState);
});

it("starts a cached layout while the previous layout request becomes stale", () => {
	const data = (entityId: string, title: string) => ({
		itemsById: new Map([[entityId, card(entityId, title)]]),
		pages: [page([entityId], null)],
	});
	let state = createSavedViewControllerState("scope:record", "list");
	const listInitial = token(state.identity, "list", state.generation + 1);
	state = savedViewControllerReducer(state, {
		phase: "initial",
		token: listInitial,
		type: "request-started",
	});
	state = savedViewControllerReducer(state, {
		token: listInitial,
		type: "request-succeeded",
		data: data("entity-list", "Cached list"),
	});
	state = savedViewControllerReducer(state, { type: "layout-changed", layout: "grid" });
	const gridInitial = token(state.identity, "grid", state.generation + 1);
	state = savedViewControllerReducer(state, {
		phase: "initial",
		token: gridInitial,
		type: "request-started",
	});
	state = savedViewControllerReducer(state, {
		token: gridInitial,
		type: "request-succeeded",
		data: data("entity-grid", "Grid"),
	});
	const gridRefresh = token(state.identity, "grid", state.generation + 1);
	state = savedViewControllerReducer(state, {
		token: gridRefresh,
		phase: "refresh",
		type: "request-started",
	});

	state = savedViewControllerReducer(state, { type: "layout-changed", layout: "list" });
	expect(state.layouts.list?.data.pages).toHaveLength(1);
	expect(isSavedViewRequestActiveFor(gridRefresh, state.identity, "list")).toBe(false);
	const listRefresh = token(state.identity, "list", state.generation + 1);
	state = savedViewControllerReducer(state, {
		token: listRefresh,
		phase: "refresh",
		type: "request-started",
	});
	const beforeGridCompletion = state;
	state = savedViewControllerReducer(state, {
		token: gridRefresh,
		type: "request-succeeded",
		data: data("stale-grid", "Stale grid"),
	});
	expect(state).toBe(beforeGridCompletion);
	state = savedViewControllerReducer(state, {
		token: listRefresh,
		type: "request-succeeded",
		data: data("entity-list", "Refreshed list"),
	});
	expect(savedViewControllerResult(state)).toMatchObject({
		layout: "list",
		entityIds: ["entity-list"],
		data: { items: [{ title: "Refreshed list" }] },
	});
});

it("coalesces refresh requests while work is active and consumes one trailing refresh", () => {
	let state = createSavedViewControllerState("scope:record", "grid");
	const initial = token(state.identity);
	state = savedViewControllerReducer(state, {
		token: initial,
		phase: "initial",
		type: "request-started",
	});
	state = savedViewControllerReducer(state, { type: "refresh-requested" });
	state = savedViewControllerReducer(state, { type: "refresh-requested" });
	expect(canRefreshSavedView(state)).toBe(false);

	state = savedViewControllerReducer(state, {
		token: initial,
		type: "request-succeeded",
		data: {
			itemsById: new Map([["entity-1", card("entity-1")]]),
			pages: [page(["entity-1"], null)],
		},
	});
	expect(canRefreshSavedView(state)).toBe(true);

	const refresh = token(state.identity, "grid", state.generation + 1);
	state = savedViewControllerReducer(state, {
		token: refresh,
		phase: "refresh",
		type: "request-started",
	});
	expect(state.pendingRefresh).toBe(false);
	expect(canRefreshSavedView(state)).toBe(false);
});

it("retains loaded data and requests a retry after a background refresh failure", () => {
	let state = createSavedViewControllerState("scope:record", "grid");
	const initial = token(state.identity);
	state = savedViewControllerReducer(state, {
		token: initial,
		phase: "initial",
		type: "request-started",
	});
	state = savedViewControllerReducer(state, {
		token: initial,
		type: "request-succeeded",
		data: {
			itemsById: new Map([["entity-1", card("entity-1")]]),
			pages: [page(["entity-1"], null)],
		},
	});
	const refresh = token(state.identity, "grid", state.generation + 1);
	state = savedViewControllerReducer(state, {
		token: refresh,
		phase: "refresh",
		type: "request-started",
	});
	state = savedViewControllerReducer(state, {
		token: refresh,
		type: "request-failed",
		failure: { status: "transport-error", cause: "offline" },
	});

	expect(state.retryRefresh).toBe(true);
	expect(savedViewControllerResult(state)).toMatchObject({
		status: "ready",
		entityIds: ["entity-1"],
	});
	state = savedViewControllerReducer(state, { type: "refresh-retry-elapsed" });
	expect(state.retryRefresh).toBe(false);
	expect(canRefreshSavedView(state)).toBe(true);
});
