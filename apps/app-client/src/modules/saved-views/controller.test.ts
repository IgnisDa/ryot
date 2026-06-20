import { expect, it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect } from "effect";

import { fetchSavedViewReplacement, isSavedViewOperationCurrent } from "./controller";
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

const ready = (entityId: string, nextCursor: string | null): SavedViewReadyState => {
	const item: SavedViewCardItem = { entityId, title: entityId, image: { type: "missing" } };
	return {
		assets: [],
		layout: "grid",
		status: "ready",
		entityIds: [entityId],
		data: { items: [item], pageInfo: { limit: 2, hasMore: nextCursor !== null, nextCursor } },
	};
};

it.effect("fetches replacement pages sequentially with fresh cursors", () =>
	Effect.gen(function* () {
		const documents: RyotQLDocument[] = [];
		const responses = [ready("entity-1", "fresh-2"), ready("entity-2", "fresh-3")];
		const replacement = yield* fetchSavedViewReplacement({
			pagesToLoad: 2,
			queryDocument: baseQuery,
			decode: () => {
				const response = responses.shift();
				return response ? Effect.succeed(response) : Effect.fail(new Error("Missing response"));
			},
			execute: (queryDocument) => {
				documents.push(queryDocument);
				return Effect.void;
			},
		});

		expect(documents[0]).toBe(baseQuery);
		expect(documents[1]?.queries.view.output).toMatchObject({
			pagination: { after: "fresh-2", limit: 2 },
		});
		expect(replacement.pages.map((page) => page.entityIds)).toEqual([["entity-1"], ["entity-2"]]);
	}),
);

it.effect("stops replacement when a fresh page has no next cursor", () =>
	Effect.gen(function* () {
		let calls = 0;
		const replacement = yield* fetchSavedViewReplacement({
			pagesToLoad: 3,
			queryDocument: baseQuery,
			decode: () => Effect.succeed(ready("entity-1", null)),
			execute: () => {
				calls += 1;
				return Effect.void;
			},
		});

		expect(calls).toBe(1);
		expect(replacement.pages).toHaveLength(1);
	}),
);

it("rejects stale identity, layout, and generation tokens", () => {
	const token = { identity: "record-1", layout: "grid", generation: 2 } as const;

	expect(isSavedViewOperationCurrent(token, token)).toBe(true);
	expect(isSavedViewOperationCurrent(token, { ...token, identity: "record-2" })).toBe(false);
	expect(isSavedViewOperationCurrent(token, { ...token, layout: "list" })).toBe(false);
	expect(isSavedViewOperationCurrent(token, { ...token, generation: 3 })).toBe(false);
});
