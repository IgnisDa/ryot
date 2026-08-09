import { EntitySchemaSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { ManagedAssetResolutionError, ManagedAssetsService } from "#/modules/assets/managed-assets";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { SavedViewLoadError, SavedViewsService } from "#/modules/saved-views/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	GodModeRouteStubs,
	ServerStub,
	catalog,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStub,
	OAuthRouteStubs,
	theme,
} from "#/routes/-route-fixtures";

const entity = table("entity", "entity");
const queryDocument = document({
	items: rows(entity, {
		limit: 2,
		fields: [
			field("entityId", column(entity, "id")),
			field("title", column(entity, "name")),
			field("rating", column(entity, "rating")),
		],
	}),
});
const card = {
	callout: null,
	overline: null,
	imageField: null,
	titleField: "title",
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const record = {
	sortOrder: 0,
	icon: "book",
	slug: "books",
	name: "Books",
	isBuiltin: true,
	isDisabled: false,
	pluginSlug: null,
	entitySchemaSlug: null,
	id: SavedViewId.make("view-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	layouts: {
		grid: { ...card, entityIdField: "entityId", queryDocument },
		list: { ...card, entityIdField: "entityId", queryDocument },
		table: {
			queryDocument,
			imageField: null,
			entityIdField: "entityId",
			columns: [
				{ label: "Title", field: "title", displayKind: "text" },
				{ label: "Rating", field: "rating", displayKind: "number" },
			],
		},
	},
} as const;
const page = {
	pageInfo: { limit: 2, hasMore: true, nextCursor: "next" },
	items: [
		{
			title: "Piranesi",
			entityId: "book-1",
			callout: { displayKind: "number", value: 4.5 } as const,
			image: { type: "local", key: "covers/piranesi" } as const,
			overline: { displayKind: "text", value: "Book" } as const,
			primaryMetadata: { displayKind: "date", value: "2026-08-12" } as const,
			secondaryMetadata: { displayKind: "text", value: "Susanna Clarke" } as const,
		},
	],
};
const tablePage = {
	pageInfo: { limit: 2, hasMore: false, nextCursor: null },
	items: [
		{
			image: null,
			entityId: "book-table",
			cells: [
				{ key: "title", label: "Title", value: { displayKind: "text", value: "Jonathan Strange" } },
				{ key: "rating", label: "Rating", value: { displayKind: "number", value: 4.75 } },
			],
		},
	],
} as const;

type SavedViewService = SavedViewsService["Service"];
type Resolve = ManagedAssetsService["Service"]["resolve"];
type StorageService = ClientStorage["Service"];

const addableRecord = { ...record, entitySchemaSlug: EntitySchemaSlug.make("book") };
const emptyPage = { pageInfo: { limit: 2, hasMore: false, nextCursor: null }, items: [] } as const;

const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const mountView = (
	overrides: Partial<SavedViewService> = {},
	resolve: Resolve = () => Effect.succeed(new Map()),
	storage: StorageService = makeStorageStub("fixture"),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			makePublicApiStub(),
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(ManagedAssetsService, { resolve }),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			Layer.succeed(SavedViewsService, {
				count: () => Effect.succeed(1),
				loadPage: () => Effect.succeed(page),
				loadRecord: () => Effect.succeed(record),
				...overrides,
			}),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, storage)),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/v/books"] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, runtime };
};

describe("saved-view route", () => {
	it("renders the decoded first grid page and all configured card slots", async () => {
		const view = mountView();
		try {
			expect(await screen.findByRole("heading", { name: "Books" })).toBeTruthy();
			expect(screen.getByText("1+ results")).toBeTruthy();
			expect(screen.getByRole("link", { name: "Open Piranesi" }).getAttribute("href")).toBe(
				"/e/book-1",
			);
			expect(screen.getByText("Book")).toBeTruthy();
			expect(screen.getByText("Susanna Clarke")).toBeTruthy();
			expect(screen.getByText("4.5")).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("uses the route not-found state for a missing record", async () => {
		const view = mountView({ loadRecord: () => Effect.succeed(undefined) });
		try {
			expect(await screen.findByRole("heading", { name: "Saved view not found" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("shows stable failure copy without exposing the internal cause", async () => {
		const view = mountView({
			loadRecord: () =>
				Effect.fail(
					new SavedViewLoadError({ stage: "record", cause: new Error("private detail") }),
				),
		});
		try {
			expect(await screen.findByRole("heading", { name: "Saved view unavailable" })).toBeTruthy();
			expect(screen.queryByText("private detail")).toBeNull();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("keeps the page usable when managed-image resolution fails", async () => {
		const view = mountView({}, () =>
			Effect.fail(new ManagedAssetResolutionError({ cause: new Error("offline") })),
		);
		try {
			expect(await screen.findByRole("link", { name: "Open Piranesi" })).toBeTruthy();
			await waitFor(() => expect(screen.queryByText("offline")).toBeNull());
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("loads the persisted table layout with configured headers and an entity link", async () => {
		const requests: Array<Parameters<SavedViewService["loadPage"]>[1]> = [];
		const storage: ClientStorage["Service"] = {
			...makeStorageStub("fixture"),
			getSavedViewLayout: () => Effect.succeed("table" as const),
		};
		const view = mountView(
			{
				loadPage: (_client, layout) => {
					requests.push(layout);
					return Effect.succeed(tablePage);
				},
			},
			undefined,
			storage,
		);
		try {
			expect(await screen.findByRole("radio", { name: "Table view", checked: true })).toBeTruthy();
			expect(screen.getByRole("columnheader", { name: "Title" })).toBeTruthy();
			expect(screen.getByRole("columnheader", { name: "Rating" })).toBeTruthy();
			expect(screen.getByText("4.75")).toBeTruthy();
			expect(screen.getByRole("link", { name: "Jonathan Strange" }).getAttribute("href")).toBe(
				"/e/book-table",
			);
			expect(requests).toEqual(["table"]);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("switches between grid, list, and table layouts and persists each selection", async () => {
		const persisted: string[] = [];
		const storage = {
			...makeStorageStub("fixture"),
			setSavedViewLayout: (
				_scope: Parameters<ClientStorage["Service"]["setSavedViewLayout"]>[0],
				_slug: string,
				layout: Parameters<ClientStorage["Service"]["setSavedViewLayout"]>[2],
			) =>
				Effect.sync(() => {
					persisted.push(layout);
				}),
		};
		const view = mountView(
			{
				loadPage: (_client, layout) =>
					Effect.succeed(
						layout === "table"
							? tablePage
							: {
									pageInfo: { limit: 2, hasMore: false, nextCursor: null },
									items: [
										{ ...page.items[0], title: layout === "grid" ? "Grid book" : "List book" },
									],
								},
					),
			},
			undefined,
			storage,
		);
		try {
			expect(await screen.findByRole("link", { name: "Open Grid book" })).toBeTruthy();

			fireEvent.click(screen.getByRole("radio", { name: "List view" }));
			expect(await screen.findByRole("link", { name: "Open List book" })).toBeTruthy();

			fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
			expect(await screen.findByRole("link", { name: "Jonathan Strange" })).toBeTruthy();

			fireEvent.click(screen.getByRole("radio", { name: "Grid view" }));
			expect(await screen.findByRole("link", { name: "Open Grid book" })).toBeTruthy();
			await waitFor(() => expect(persisted).toEqual(["list", "table", "grid"]));
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("loads the next cursor page, deduplicates entity IDs, and keeps the latest entity data", async () => {
		const documents: Array<Parameters<SavedViewService["loadPage"]>[3]> = [];
		const view = mountView({
			loadPage: (_client, _layout, _definition, requestDocument) => {
				documents.push(requestDocument);
				return Effect.succeed(
					documents.length === 1
						? page
						: {
								pageInfo: { limit: 2, hasMore: false, nextCursor: null },
								items: [
									{ ...page.items[0], title: "Piranesi revised" },
									{ ...page.items[0], entityId: "book-2", title: "The City & The City" },
								],
							},
				);
			},
		});
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Load more results" }));

			expect(await screen.findByRole("link", { name: "Open Piranesi revised" })).toBeTruthy();
			expect(screen.getByRole("link", { name: "Open The City & The City" })).toBeTruthy();
			expect(screen.queryByRole("link", { name: "Open Piranesi" })).toBeNull();
			expect(screen.getByText("End of Books · 2 items")).toBeTruthy();
			expect(documents).toHaveLength(2);
			expect(documents[0]).toBe(queryDocument);
			expect(documents[1]).toMatchObject({
				queries: { items: { output: { pagination: { after: "next", limit: 2 } } } },
			});
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("shows a lower-bound count then the distinct total from Count all", async () => {
		const countCalls: Array<{
			readonly field: string;
			readonly document: Parameters<SavedViewService["count"]>[1];
		}> = [];
		const view = mountView({
			count: (_client, requestDocument, fieldName) =>
				Effect.sync(() => {
					countCalls.push({ field: fieldName, document: requestDocument });
					return 37;
				}),
		});
		try {
			expect(await screen.findByText("1+ results")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Count all" }));

			expect(await screen.findByText("1 of 37 results")).toBeTruthy();
			expect(countCalls).toEqual([{ document: queryDocument, field: "entityId" }]);
			expect(screen.queryByRole("button", { name: "Count all" })).toBeNull();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("debounces normalized search into a new request document with title predicates", async () => {
		const documents: Array<Parameters<SavedViewService["loadPage"]>[3]> = [];
		const view = mountView({
			loadPage: (_client, _layout, _definition, requestDocument) => {
				documents.push(requestDocument);
				return Effect.succeed(
					documents.length === 1
						? page
						: {
								pageInfo: { limit: 2, hasMore: false, nextCursor: null },
								items: [{ ...page.items[0], title: "Search match" }],
							},
				);
			},
		});
		try {
			fireEvent.change(await screen.findByRole("searchbox", { name: "Search Books" }), {
				target: { value: "  sea_term  " },
			});

			expect(await screen.findByRole("link", { name: "Open Search match" })).toBeTruthy();
			expect(documents).toHaveLength(2);
			expect(documents[0]).toBe(queryDocument);
			expect(documents[1]).not.toBe(queryDocument);
			expect(documents[1]).toMatchObject({
				queries: {
					items: {
						where: {
							type: "and",
							predicates: [
								{ type: "contains", right: { value: "sea" } },
								{ type: "contains", right: { value: "term" } },
							],
						},
					},
				},
			});
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("offers no online-search actions for a view without an entity schema", async () => {
		const view = mountView();
		try {
			expect(await screen.findByRole("heading", { name: "Books" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Add to this view" })).toBeNull();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("offers both add affordances when the view maps an entity schema", async () => {
		const view = mountView({ loadRecord: () => Effect.succeed(addableRecord) });
		try {
			expect(await screen.findByRole("button", { name: "Add" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Add to this view" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("invites an online search from an empty addable view", async () => {
		const view = mountView({
			loadPage: () => Effect.succeed(emptyPage),
			loadRecord: () => Effect.succeed(addableRecord),
		});
		try {
			expect(await screen.findByRole("heading", { name: "Books is empty" })).toBeTruthy();
			expect(screen.getByText("Search online to add your first item.")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Search online" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("keeps an empty view without an entity schema free of add copy", async () => {
		const view = mountView({ loadPage: () => Effect.succeed(emptyPage) });
		try {
			expect(await screen.findByRole("heading", { name: "Books is empty" })).toBeTruthy();
			expect(screen.getByText("No items have been added to this view yet.")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Search online" })).toBeNull();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("suggests an online search for the query when nothing matches", async () => {
		let pages = 0;
		const view = mountView({
			loadRecord: () => Effect.succeed(addableRecord),
			loadPage: () => {
				pages += 1;
				return Effect.succeed(pages === 1 ? page : emptyPage);
			},
		});
		try {
			fireEvent.change(await screen.findByRole("searchbox", { name: "Search Books" }), {
				target: { value: "dune" },
			});

			expect(
				await screen.findByRole("button", { name: "Search online for \u201cdune\u201d" }),
			).toBeTruthy();
			expect(screen.getByRole("heading", { name: "No matches in Books" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("disables the filters control until the view has results", async () => {
		const view = mountView({ loadPage: () => Effect.succeed(emptyPage) });
		try {
			const filters = await screen.findByRole("button", { name: "Open filters, 0 active" });
			expect(filters.hasAttribute("disabled")).toBe(true);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("does not let a deferred stale layout response replace the current table result", async () => {
		const staleList = deferred<{
			readonly pageInfo: { readonly limit: 2; readonly hasMore: false; readonly nextCursor: null };
			readonly items: typeof page.items;
		}>();
		const view = mountView({
			loadPage: (_client, layout) => {
				if (layout === "list") {
					return Effect.promise(() => staleList.promise);
				}
				return Effect.succeed(layout === "table" ? tablePage : page);
			},
		});
		try {
			expect(await screen.findByRole("link", { name: "Open Piranesi" })).toBeTruthy();
			fireEvent.click(screen.getByRole("radio", { name: "List view" }));
			await screen.findByText("Updating...");

			fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
			expect(await screen.findByRole("link", { name: "Jonathan Strange" })).toBeTruthy();

			staleList.resolve({
				pageInfo: { limit: 2, hasMore: false, nextCursor: null },
				items: [{ ...page.items[0], title: "Stale list result" }],
			});
			await waitFor(() => {
				expect(screen.getByRole("radio", { name: "Table view", checked: true })).toBeTruthy();
				expect(screen.queryByText("Stale list result")).toBeNull();
			});
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("keeps the remembered workspace as the sidebar identity", async () => {
		const view = mountView();
		try {
			await screen.findByRole("heading", { name: "Books" });
			expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
			expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/fixture");
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});
});
