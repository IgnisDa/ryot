import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { appendSavedViewPage } from "#/modules/saved-views/controller";
import { withSavedViewCursor } from "#/modules/saved-views/query";
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
const settledSync = { populationStatus: "ready", translationStatus: "none" } as const;
const rowsResult = (items: readonly unknown[]) => ({ type: "rows", items, pageInfo });

describe("SavedViewsService", () => {
	it("rejects a later refresh page without exposing a partial replacement", async () => {
		let requests = 0;
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => {
					requests += 1;
					return requests === 1
						? Promise.resolve({ data: { savedView: rowsResult([]) } })
						: Promise.reject(new Error("offline"));
				},
			}),
		);
		const current = {
			...appendSavedViewPage(
				undefined,
				{
					pageInfo,
					items: [{ entityId: "one", title: "Original", image: null, sync: settledSync }],
				},
				queryDocument,
				new Map(),
			),
			pages: 2,
		};
		const runtime = ManagedRuntime.make(SavedViewsService.layer);
		try {
			await expect(
				runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) =>
						service.refresh(client, "grid", record.layouts.grid, current),
					),
				),
			).rejects.toMatchObject({ stage: "page" });
			expect(requests).toBe(2);
			expect(current.items).toEqual([
				{ entityId: "one", title: "Original", image: null, sync: settledSync },
			]);
		} finally {
			await runtime.dispose();
		}
	});

	it.each([1, 2, 4])(
		"refreshes up to loaded depth %i with fresh cursors, sorting, deduplication and early end",
		async (depth) => {
			const documents: unknown[] = [];
			const client = createRyotClient(
				createTestRyotAdapter({
					query: (query) => {
						documents.push(query);
						const first = documents.length === 1;
						return Promise.resolve({
							data: {
								savedView: {
									type: "rows",
									pageInfo: { limit: 2, hasMore: first, nextCursor: first ? "fresh" : null },
									items: (first ? ["three", "two"] : ["two", "four"]).map((entityId) => ({
										entityId,
										image: null,
										primary: null,
										callout: null,
										overline: null,
										secondary: null,
										populationStatus: "ready",
										translationStatus: "none",
										title: `${entityId}-${documents.length}`,
									})),
								},
							},
						});
					},
				}),
			);
			const current = {
				...appendSavedViewPage(
					undefined,
					{
						pageInfo,
						items: [{ entityId: "removed", title: "Removed", image: null, sync: settledSync }],
					},
					withSavedViewCursor(queryDocument, "stale"),
					new Map(),
				),
				pages: depth,
			};
			const runtime = ManagedRuntime.make(SavedViewsService.layer);
			try {
				const result = await runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) =>
						service.refresh(client, "grid", record.layouts.grid, current),
					),
				);
				expect(documents).toHaveLength(Math.min(depth, 2));
				expect(documents[0]).not.toMatchObject({
					queries: { savedView: { output: { pagination: { after: expect.anything() } } } },
				});
				if (depth === 1) {
					expect(result.items.map((item) => item.entityId)).toEqual(["three", "two"]);
					expect(result.pageInfo).toEqual({ limit: 2, hasMore: true, nextCursor: "fresh" });
				} else {
					expect(documents[1]).toMatchObject({
						queries: { savedView: { output: { pagination: { after: "fresh" } } } },
					});
					expect(result.items.map((item) => item.entityId)).toEqual(["three", "two", "four"]);
					expect(result.items[1]).toMatchObject({ title: "two-2" });
					expect(result.pageInfo.hasMore).toBe(false);
				}
				expect(result.pages).toBe(Math.min(depth, 2));
				expect(current.items[0]?.entityId).toBe("removed");
			} finally {
				await runtime.dispose();
			}
		},
	);

	it("loads a record and executes its persisted grid document", async () => {
		const documents: unknown[] = [];
		const client = createRyotClient(
			createTestRyotAdapter({
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
												populationStatus: "ready",
												translationStatus: "none",
												secondary: "Susanna Clarke",
												image: { type: "remote", url: "https://images.example/piranesi" },
											},
										]),
									},
								},
					);
				},
			}),
		);
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
		const client = createRyotClient(
			createTestRyotAdapter({
				query: () => Promise.resolve({ data: { savedView: rowsResult([]) } }),
			}),
		);
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
