import { createRyotClient } from "@ryot-app/client-sdk";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { SavedViewsService } from "#/modules/saved-views/service";

const entity = table("entity", "entity");
const queryDocument = document({
	configuredGrid: rows(entity, {
		limit: 2,
		fields: [
			field("entityId", column(entity, "id")),
			field("title", column(entity, "name")),
			field("image", column(entity, "image")),
			field("overline", column(entity, "kind")),
			field("primary", column(entity, "publishedAt")),
			field("secondary", column(entity, "author")),
			field("callout", column(entity, "rating")),
		],
	}),
});
const card = {
	imageField: "image",
	titleField: "title",
	callout: { field: "callout", displayKind: "number" },
	overline: { field: "overline", displayKind: "text" },
	primaryMetadata: { field: "primary", displayKind: "date" },
	secondaryMetadata: { field: "secondary", displayKind: "text" },
} as const;
const record = {
	id: "view-1",
	icon: "book",
	sortOrder: 0,
	slug: "books",
	name: "Books",
	isBuiltin: true,
	pluginSlug: null,
	isDisabled: false,
	entitySchemaSlug: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	layouts: {
		grid: { ...card, entityIdField: "entityId", queryDocument },
		list: { ...card, entityIdField: "entityId", queryDocument },
		table: {
			queryDocument,
			imageField: "image",
			entityIdField: "entityId",
			columns: [{ label: "Title", field: "title", displayKind: "text" }],
		},
	},
} as const;
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" } as const;
const rowsResult = (items: readonly unknown[]) => ({ type: "rows", items, pageInfo });

describe("SavedViewsService", () => {
	it("loads a record and executes its persisted grid document", async () => {
		const documents: unknown[] = [];
		const client = createRyotClient({
			query: (query) => {
				documents.push(query);
				return Promise.resolve(
					documents.length === 1
						? { data: { savedView: rowsResult([record]) } }
						: {
								data: {
									savedView: rowsResult([
										{
											callout: 4.5,
											overline: "Book",
											title: "Piranesi",
											entityId: "book-1",
											primary: "2026-08-12",
											secondary: "Susanna Clarke",
											image: { type: "remote", url: "https://images.example/piranesi" },
										},
									]),
								},
							},
				);
			},
		});
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		try {
			const loadedRecord = await runtime.runPromise(
				Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "books")),
			);
			const page = await runtime.runPromise(
				Effect.flatMap(SavedViewsService, (service) =>
					service.loadPage(client, "grid", record.layouts.grid, queryDocument),
				),
			);

			expect(loadedRecord?.name).toBe("Books");
			expect(page.items[0]).toMatchObject({
				title: "Piranesi",
				entityId: "book-1",
				callout: { displayKind: "number", value: 4.5 },
			});
			expect(documents).toHaveLength(2);
			expect(documents[1]).toMatchObject({
				queries: { savedView: { output: { pagination: { limit: 2 } } } },
			});
			expect(documents[1]).not.toMatchObject({
				queries: { savedView: { output: { pagination: { after: expect.anything() } } } },
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("returns undefined when the saved-view record does not exist", async () => {
		const client = createRyotClient({
			query: () => Promise.resolve({ data: { savedView: rowsResult([]) } }),
		});
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) => service.loadRecord(client, "missing")),
				),
			).resolves.toBeUndefined();
		} finally {
			await runtime.dispose();
		}
	});
});
