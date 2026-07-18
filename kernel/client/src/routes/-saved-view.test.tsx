import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
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
import { PROVIDER_IMPORT_UNAVAILABLE_MESSAGE } from "#/modules/provider-add/import-controller";
import { ProviderAddLoadError, ProviderAddService } from "#/modules/provider-add/service";
import { SavedViewLoadError, SavedViewsService } from "#/modules/saved-views/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	OAuthRouteStubs,
	GodModeRouteStubs,
	ProviderAddRouteStubs,
	theme,
	catalog,
	makeAuthStub,
	makeStorageStub,
	makePublicApiStub,
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

const importedPage = {
	pageInfo: { limit: 2, hasMore: false, nextCursor: null },
	items: [{ image: null, title: "Imported Dune", entityId: "book-imported" }],
};

const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

type ProviderAdd = ProviderAddService["Service"];
type ProviderSearchItem = { readonly title: string; readonly externalId: string };

const bookSlug = EntitySchemaSlug.make("book");
const firstProviderId = SandboxProviderId.make("provider-1");

const providerFixture = (index: number, searchOptionsSchema: AppSchema | null = null) => ({
	searchOptionsSchema,
	rootEntitySchemaSlug: bookSlug,
	providerSlug: `provider-${index}`,
	providerName: `Provider ${index}`,
	providerId: SandboxProviderId.make(`provider-${index}`),
});

const providerResult = (providers: ReadonlyArray<ReturnType<typeof providerFixture>>) => ({
	items: providers,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const searchResult = (items: ReadonlyArray<ProviderSearchItem>) => ({
	items,
	providerName: "Provider 1",
	providerId: firstProviderId,
	rootEntitySchemaSlug: bookSlug,
	details: { nextPage: null, totalItems: items.length },
});

const importedEntity = (id: string) =>
	({
		status: "completed",
		data: {
			name: "Dune",
			properties: {},
			populatedAt: null,
			externalId: "dune",
			entitySchemaSlug: bookSlug,
			providerId: firstProviderId,
			id: EntityId.make(id),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	}) as const;

const booleanOptionsSchema: AppSchema = {
	fields: {
		includeAdult: { type: "boolean", label: "Include adult", description: "Include adult titles" },
	},
};

const genreOptionsSchema: AppSchema = {
	fields: {
		genres: {
			label: "Genres",
			type: "enum-array",
			description: "Limit to genres",
			choices: { kind: "static", values: [{ value: "scifi", label: "Sci-fi" }] },
		},
	},
};

const makeProviderAdd = (
	overrides: Partial<ProviderAdd> = {},
	providers: ReadonlyArray<ReturnType<typeof providerFixture>> = [providerFixture(1)],
) =>
	Layer.succeed(ProviderAddService, {
		pollImport: () => Effect.die("not used"),
		startImport: () => Effect.die("not used"),
		loadEntityLinks: () => Effect.succeed([]),
		search: () => Effect.succeed(searchResult([])),
		loadSearchOptions: () => Effect.die("not used"),
		loadProviders: () => Effect.succeed(providerResult(providers)),
		...overrides,
	});

const mountAddableView = (
	providerAdd: Layer.Layer<ProviderAddService>,
	overrides: Partial<SavedViewService> = {},
	storage: StorageService = makeStorageStub("fixture"),
) =>
	mountView(
		{ loadRecord: () => Effect.succeed(addableRecord), ...overrides },
		undefined,
		storage,
		providerAdd,
	);

const addDialog = () => screen.queryByRole("dialog", { name: "Add from a provider" });
const findAddDialog = () => screen.findByRole("dialog", { name: "Add from a provider" });

const mountView = (
	overrides: Partial<SavedViewService> = {},
	resolve: Resolve = () => Effect.succeed(new Map()),
	storage: StorageService = makeStorageStub("fixture"),
	providerAdd: Layer.Layer<ProviderAddService> = ProviderAddRouteStubs,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			providerAdd,
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
	const backInterceptors = createBackInterceptors();
	const router = getRouter(
		{ runtime, theme, backInterceptors },
		createMemoryHistory({ initialEntries: ["/v/books"] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, runtime, backInterceptors };
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

describe("saved-view provider add flow", () => {
	it("opens the flow from the header Add button and closes it without reloading the record", async () => {
		let records = 0;
		const view = mountAddableView(makeProviderAdd(), {
			loadRecord: () =>
				Effect.sync(() => {
					records += 1;
					return addableRecord;
				}),
		});
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));

			expect(await findAddDialog()).toBeTruthy();
			expect(view.router.state.location.search).toEqual({ add: true });
			expect(await screen.findByRole("radio", { name: "Provider 1", checked: true })).toBeTruthy();

			fireEvent.keyDown(window.document, { key: "Escape" });

			await waitFor(() => expect(addDialog()).toBeNull());
			expect(view.router.state.location.search).toEqual({});
			expect(records).toBe(1);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("opens the flow from the mobile add button, the empty state, and the A shortcut", async () => {
		const view = mountAddableView(makeProviderAdd(), {
			loadPage: () => Effect.succeed(emptyPage),
		});
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add to this view" }));
			expect(await findAddDialog()).toBeTruthy();

			fireEvent.keyDown(window.document, { key: "Escape" });
			await waitFor(() => expect(addDialog()).toBeNull());

			fireEvent.click(screen.getByRole("button", { name: "Search online" }));
			expect(await findAddDialog()).toBeTruthy();

			fireEvent.keyDown(window.document, { key: "Escape" });
			await waitFor(() => expect(addDialog()).toBeNull());

			fireEvent.keyDown(window.document, { key: "A" });
			expect(await findAddDialog()).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("keeps the page shortcuts inert while the flow is open", async () => {
		let pages = 0;
		const view = mountAddableView(makeProviderAdd(), {
			loadPage: () =>
				Effect.sync(() => {
					pages += 1;
					return pages === 1 ? page : emptyPage;
				}),
		});
		try {
			fireEvent.change(await screen.findByRole("searchbox", { name: "Search Books" }), {
				target: { value: "dune" },
			});
			fireEvent.click(
				await screen.findByRole("button", { name: "Search online for \u201cdune\u201d" }),
			);
			await findAddDialog();
			const chip = await screen.findByRole("radio", { name: "Provider 1" });
			chip.focus();

			fireEvent.keyDown(window.document, { key: "/" });
			fireEvent.keyDown(window.document, { key: "A" });

			expect(window.document.activeElement).toBe(chip);
			expect(view.router.state.location.search).toEqual({ add: true, q: "dune" });
			expect(screen.getAllByRole("dialog", { name: "Add from a provider" })).toHaveLength(1);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("seeds the provider query from the no-matches action and searches for it", async () => {
		const payloads: Array<{ readonly query: string; readonly page: number }> = [];
		let pages = 0;
		const view = mountAddableView(
			makeProviderAdd({
				search: (_scope, payload) =>
					Effect.sync(() => {
						payloads.push({ page: payload.page, query: payload.query });
						return searchResult([{ title: "Dune", externalId: "dune" }]);
					}),
			}),
			{
				loadPage: () =>
					Effect.sync(() => {
						pages += 1;
						return pages === 1 ? page : emptyPage;
					}),
			},
		);
		try {
			fireEvent.change(await screen.findByRole("searchbox", { name: "Search Books" }), {
				target: { value: "dune" },
			});
			fireEvent.click(await screen.findByRole("button", { name: "Search online for “dune”" }));

			expect(await findAddDialog()).toBeTruthy();
			expect(view.router.state.location.search).toEqual({ add: true, q: "dune" });
			expect(screen.getByRole("textbox", { name: "Search providers" })).toHaveProperty(
				"value",
				"dune",
			);
			expect(await screen.findByRole("button", { name: "Add Dune" })).toBeTruthy();
			expect(payloads).toEqual([{ page: 1, query: "dune" }]);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("persists the picked provider and searches it after the debounce", async () => {
		const persisted: string[] = [];
		const payloads: Array<{ readonly providerId: string; readonly query: string }> = [];
		const storage: StorageService = {
			...makeStorageStub("fixture"),
			setRememberedProvider: (_scope, _slug, providerId) =>
				Effect.sync(() => {
					persisted.push(providerId);
				}),
			getRememberedProvider: () => Effect.succeed(SandboxProviderId.make("provider-2")),
		};
		const view = mountAddableView(
			makeProviderAdd(
				{
					search: (_scope, payload) =>
						Effect.sync(() => {
							payloads.push({ query: payload.query, providerId: payload.providerId });
							return searchResult([{ title: "Dune", externalId: "dune" }]);
						}),
				},
				[providerFixture(1), providerFixture(2)],
			),
			{},
			storage,
		);
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			expect(await screen.findByRole("radio", { name: "Provider 2", checked: true })).toBeTruthy();

			fireEvent.click(screen.getByRole("radio", { name: "Provider 1" }));
			await waitFor(() => expect(persisted).toEqual(["provider-1"]));

			fireEvent.change(screen.getByRole("textbox", { name: "Search providers" }), {
				target: { value: "dune" },
			});

			expect(await screen.findByRole("button", { name: "Add Dune" })).toBeTruthy();
			expect(payloads).toEqual([{ providerId: "provider-1", query: "dune" }]);
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("re-runs the search with the advanced options payload when an option changes", async () => {
		const payloads: Array<Record<string, unknown> | undefined> = [];
		const view = mountAddableView(
			makeProviderAdd(
				{
					loadSearchOptions: () => Effect.succeed({ schema: booleanOptionsSchema }),
					search: (_scope, payload) =>
						Effect.sync(() => {
							payloads.push(payload.options);
							return searchResult([{ title: "Dune", externalId: "dune" }]);
						}),
				},
				[providerFixture(1, booleanOptionsSchema)],
			),
		);
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			fireEvent.change(await screen.findByRole("textbox", { name: "Search providers" }), {
				target: { value: "dune" },
			});
			expect(await screen.findByRole("button", { name: "Add Dune" })).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Advanced options" }));
			fireEvent.click(await screen.findByRole("switch", { name: "Include adult" }));

			await waitFor(() => expect(payloads).toHaveLength(2));
			expect(payloads[0]).toBeUndefined();
			expect(payloads[1]).toEqual({ includeAdult: true });
			expect(screen.getByText("(1)")).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("marks already-linked results as in library and reloads the view once after an import", async () => {
		let records = 0;
		const jobs: string[] = [];
		const view = mountAddableView(
			makeProviderAdd({
				pollImport: () => Effect.succeed(importedEntity("book-imported")),
				loadEntityLinks: () =>
					Effect.succeed([{ externalId: "sand", entityId: EntityId.make("book-sand") }]),
				search: () =>
					Effect.succeed(
						searchResult([
							{ title: "Dune", externalId: "dune" },
							{ title: "Sand", externalId: "sand" },
						]),
					),
				startImport: (_scope, payload) =>
					Effect.sync(() => {
						jobs.push(payload.externalId);
						return { jobId: "job-1" };
					}),
			}),
			{
				loadPage: () => (records > 1 ? Effect.succeed(importedPage) : Effect.succeed(emptyPage)),
				loadRecord: () =>
					Effect.sync(() => {
						records += 1;
						return addableRecord;
					}),
			},
		);
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			fireEvent.change(await screen.findByRole("textbox", { name: "Search providers" }), {
				target: { value: "dune" },
			});

			expect(await screen.findByRole("link", { name: "Open Sand in library" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Add Sand" })).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Add Dune" }));

			expect(await screen.findByRole("link", { name: "Open Dune in library" })).toBeTruthy();
			expect(jobs).toEqual(["dune"]);
			expect(records).toBe(1);

			fireEvent.keyDown(window.document, { key: "Escape" });

			await waitFor(() => expect(records).toBe(2));
			expect(addDialog()).toBeNull();
			expect(await screen.findByText("Imported Dune")).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("reports a failed import and offers a retry", async () => {
		const view = mountAddableView(
			makeProviderAdd({
				startImport: () =>
					Effect.fail(new ProviderAddLoadError({ stage: "import", cause: new Error("offline") })),
				search: () => Effect.succeed(searchResult([{ title: "Dune", externalId: "dune" }])),
			}),
		);
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			fireEvent.change(await screen.findByRole("textbox", { name: "Search providers" }), {
				target: { value: "dune" },
			});
			fireEvent.click(await screen.findByRole("button", { name: "Add Dune" }));

			expect(await screen.findByText(PROVIDER_IMPORT_UNAVAILABLE_MESSAGE)).toBeTruthy();
			expect(screen.getByRole("button", { name: "Retry adding Dune" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("closes only the nested option picker on Escape", async () => {
		const view = mountAddableView(
			makeProviderAdd({ loadSearchOptions: () => Effect.succeed({ schema: genreOptionsSchema }) }, [
				providerFixture(1, genreOptionsSchema),
			]),
		);
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			fireEvent.click(await screen.findByRole("button", { name: "Advanced options" }));
			fireEvent.click(await screen.findByRole("button", { name: "Genres" }));

			expect(await screen.findByRole("dialog", { name: "Genres" })).toBeTruthy();

			fireEvent.keyDown(window.document, { key: "Escape" });

			await waitFor(() => expect(screen.queryByRole("dialog", { name: "Genres" })).toBeNull());
			expect(addDialog()).toBeTruthy();

			fireEvent.keyDown(window.document, { key: "Escape" });
			await waitFor(() => expect(addDialog()).toBeNull());
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("closes the flow when Android back runs the registered interceptor", async () => {
		const view = mountAddableView(makeProviderAdd());
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Add" }));
			await findAddDialog();

			expect(view.backInterceptors.run()).toBe(true);

			await waitFor(() => expect(addDialog()).toBeNull());
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});
});
