import { expect, it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { withSavedViewCursor } from "./atom-requests";
import {
	createSavedViewControllerState,
	fetchSavedViewPages,
	savedViewControllerReducer,
	savedViewControllerResult,
	type SavedViewOperationToken,
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
			type: "request-started",
			phase: "structural",
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
		const structural = token(state.identity, "grid", state.generation + 1);
		state = savedViewControllerReducer(state, {
			token: structural,
			type: "request-started",
			phase: "structural",
		});
		state = savedViewControllerReducer(state, {
			token: structural,
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

it("hydrates only requested entities that remain loaded", () => {
	let state = createSavedViewControllerState("scope:record", "grid");
	const operation = token(state.identity);
	state = savedViewControllerReducer(state, {
		token: operation,
		type: "request-started",
		phase: "initial",
	});
	state = savedViewControllerReducer(state, {
		token: operation,
		type: "request-succeeded",
		data: {
			itemsById: new Map([["entity-1", card("entity-1", "Old")]]),
			pages: [
				{
					queryDocument: baseQuery,
					entityIds: ["entity-1"],
					pageInfo: { limit: 2, hasMore: false, nextCursor: null },
				},
			],
		},
	});
	state = savedViewControllerReducer(state, {
		type: "hydration-succeeded",
		token: { ...operation, generation: state.generation },
		entityIds: ["entity-1"],
		items: [card("entity-1", "Updated"), card("entity-2", "Unrelated")],
	});
	expect(savedViewControllerResult(state)).toMatchObject({
		entityIds: ["entity-1"],
		data: { items: [{ title: "Updated" }] },
	});
});
