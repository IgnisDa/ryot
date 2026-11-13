import { afterEach, describe, expect } from "bun:test";

import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	defineEntityPresentation,
	type EntityPresentationRegistration,
} from "@ryot-app/plugin-client-sdk/plugin";
import type { mountPluginPage } from "@ryot-app/plugin-client-sdk/testing";
import {
	createTestRyotClock,
	disposePluginBridges,
	routeLocation,
	savedViewPageContext,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { assert } from "@ryot-app/testing/assert";
import { objectContaining } from "@ryot-app/testing/matchers";
import { chooseMenuItem, openMenu } from "@ryot-app/testing/menus";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Result, Schema } from "effect";

import CollectionBrowserPage from "./collection-browser";
import EntityBrowserPage from "./entity-browser";
import {
	browserDataSources,
	browserPage,
	browserRow,
	browserSettings,
	mountBrowsingPage,
} from "./fixtures/saved-view";

let views = 0;
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

const openBrowser = (
	options: {
		readonly search?: string;
		readonly savedViewId?: string;
		readonly settings?: Record<string, JsonValue>;
		readonly clock?: ReturnType<typeof createTestRyotClock>;
		readonly entityPresentations?: readonly EntityPresentationRegistration[];
	} = {},
) => {
	views += 1;
	const page = mountBrowsingPage(EntityBrowserPage, {
		bootstrap: options.clock?.bootstrap,
		entityPresentations: options.entityPresentations,
		location: routeLocation("/v/all-items", options.search ?? ""),
		page: savedViewPageContext({
			rendererName: "entity-browser",
			dataSources: browserDataSources,
			view: { icon: "book", name: "All Items" },
			settings: options.settings ?? browserSettings,
			savedViewId: options.savedViewId ?? `view-${views}`,
		}),
	});
	return page;
};

const openCollectionBrowser = () => {
	views += 1;
	return mountBrowsingPage(CollectionBrowserPage, {
		location: routeLocation("/v/collections"),
		page: savedViewPageContext({
			dataSources: browserDataSources,
			rendererName: "collection-browser",
			savedViewId: `collection-view-${views}`,
			view: { icon: "library", name: "All Collections" },
			settings: {
				...browserSettings,
				tableColumns: [
					...browserSettings.tableColumns,
					{ label: "Items", field: "memberCount", displayKind: "number" },
				],
			},
		}),
	});
};

const testClock = () => {
	const clock = createTestRyotClock();
	clocks.push(clock);
	return clock;
};
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const browserRequest = (page: ReturnType<typeof mountPluginPage>, index: number) =>
	Effect.gen(function* () {
		yield* Effect.promise(() =>
			waitFor(() => expect(page.queryRequests("savedView").length).toBeGreaterThan(index)),
		);
		const request = page.queryRequests("savedView")[index];
		if (!request) {
			return yield* Effect.die(new Error(`Entity browser request ${index} was not issued`));
		}
		return request;
	});

const replyBrowser = (
	page: ReturnType<typeof mountPluginPage>,
	requestId: string,
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: null | string = null,
) =>
	page.replyQuery(requestId, {
		outcome: "success",
		response: browserPage(items, hasMore, nextCursor),
	});

const collectionBrowserRow = (entityId: string, name: string) => ({
	...browserRow(entityId, name),
	__entityBrowserOwnerPluginId: null,
	__entityBrowserSchemaSlug: "collection",
	memberCount: name === "Favorites" ? 2 : 0,
});

const answerBrowser = (
	page: ReturnType<typeof mountPluginPage>,
	answered: Set<string>,
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: null | string = null,
) =>
	waitFor(() => {
		const pending = page
			.queryRequests("savedView")
			.filter(({ requestId }) => !answered.has(requestId));
		expect(pending.length).toBeGreaterThan(0);
		for (const request of pending) {
			answered.add(request.requestId);
			page.replyQuery(request.requestId, {
				outcome: "success",
				response: browserPage(items, hasMore, nextCursor),
			});
		}
	});

describe("entity browser", () => {
	afterEach(() => {
		disposePluginBridges();
		return Promise.all(clocks.splice(0).map((clock) => clock.dispose()));
	});

	it.live(
		"titles the screen with the saved view and announces its shipped chrome",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("1 result")),
				);

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { level: 1, name: "All Items" })).toBeTruthy(),
					),
				);
				const search = screen.getByRole("searchbox", { name: "Search All Items" });
				expect(search.getAttribute("aria-keyshortcuts")).toBe("/");
				const filters = screen.getByRole("button", { name: /Filters/ });
				expect(filters.hasAttribute("disabled")).toBe(false);
				expect(filters.getAttribute("aria-label")).toBe("Filters, 0 active filters");
				expect(screen.queryByRole("button", { name: /^Sort by/ })).toBeNull();
				const add = screen.getByRole("button", { name: "Add" });
				expect(add.getAttribute("aria-keyshortcuts")).toBe("A");
				expect(screen.getByRole("radio", { name: "Grid view" })).toBeTruthy();
				expect(screen.getByRole("radio", { name: "Table view" })).toBeTruthy();
				fireEvent.click(filters);
				const dialog = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("dialog", { name: "Filters" })),
				);
				expect(dialog.textContent).toContain("Add filter");
				expect(screen.getByRole("button", { name: /^Sort by/ })).toBeTruthy();
				expect(dialog.textContent).not.toContain("View as");
			}),
		testTimeout,
	);

	it.live(
		"shares the saved view through the kernel share sheet",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ savedViewId: "shared-view" });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				yield* chooseMenuItem("More actions", "Share");
				const share = yield* Effect.promise(() =>
					waitFor(() => {
						const found = page
							.clientMessages()
							.find((message) => message.type === "share-publication-screen");
						expect(found).toBeDefined();
						return found;
					}),
				);
				expect(share).toMatchObject({
					source: { kind: "saved-view", reference: { kind: "kernel", slug: "shared-view" } },
				});
			}),
		testTimeout,
	);

	it.live(
		"adds every loaded result to a collection through the kernel collection members screen",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [
						browserRow("item-1", "Example"),
						browserRow("item-2", "Second"),
					]),
				);
				yield* chooseMenuItem("More actions", "Select");
				const selection = screen.getByRole("region", { name: "Selection" });
				expect(within(selection).getByRole("button", { name: "Add to collection" })).toHaveProperty(
					"disabled",
					true,
				);
				fireEvent.click(within(selection).getByRole("button", { name: "Select all 2" }));
				expect(selection.textContent).toContain("2 selected");
				fireEvent.click(within(selection).getByRole("button", { name: "Add to collection" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>(
							objectContaining({
								kind: "add",
								entityIds: ["item-1", "item-2"],
								type: "change-collection-members-screen",
							}),
						),
					),
				);
				expect(page.queryRequests("ids")).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"offers New collection instead of an online search from an empty collections list",
		() =>
			Effect.gen(function* () {
				const page = openCollectionBrowser();
				yield* Effect.promise(() => answerBrowser(page, new Set(), []));
				yield* Effect.promise(() =>
					screen.findByText("No items have been added to this view yet."),
				);
				expect(screen.queryByRole("button", { name: "Search online" })).toBeNull();
				const create = screen.getAllByRole("button", { name: "New collection" });
				expect(create).toHaveLength(2);
				const fromEmptyState = create.at(-1);
				assert(fromEmptyState !== undefined);
				fireEvent.click(fromEmptyState);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>(
							objectContaining({ type: "edit-collection-screen" }),
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"does not offer sharing on the collections list",
		() =>
			Effect.gen(function* () {
				const page = openCollectionBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, new Set(), [browserRow("item-2", "Shelf")]),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("1 result")),
				);
				yield* openMenu("More actions");
				expect(screen.getByRole("menuitem", { name: "Select" })).toBeTruthy();
				expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"shows the invalid-configuration state for settings the browser schema rejects",
		() =>
			Effect.gen(function* () {
				const { subject: _subject, ...withoutSubject } = browserSettings;
				openBrowser({ settings: withoutSubject });
				yield* Effect.promise(() =>
					screen.findByText("This entity browser configuration is invalid."),
				);
			}),
		testTimeout,
	);

	it.live(
		"renders plugin presentation data from the ordered browser request",
		() =>
			Effect.gen(function* () {
				const presentation = defineEntityPresentation<string>({
					component: ({ data }) => <p>{`Presented ${data}`}</p>,
					prepare: ({ sources, references }) =>
						Result.all(
							Object.fromEntries(
								references.map(({ entityId }) => {
									const value = sources.get(entityId)?.["name"];
									return [
										entityId,
										typeof value === "string"
											? Result.succeed(value)
											: Result.fail(new Error("Missing presentation name")),
									];
								}),
							),
						),
				});
				const page = openBrowser({
					entityPresentations: [
						{
							layout: "grid",
							ownerPluginId: "fixture",
							entitySchemaSlug: "item",
							load: () => Promise.resolve(presentation),
						},
					],
				});
				const request = yield* browserRequest(page, 0);
				replyBrowser(page, request.requestId, [
					browserRow("item-2", "Second"),
					browserRow("item-1", "First"),
				]);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.container?.textContent).toContain("Presented SecondPresented First"),
					),
				);
				expect(page.queryRequests("savedView")).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"registers its page shortcuts upward and opens provider search on a kernel press",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual({
							type: "page-shortcuts",
							shortcuts: ["/", "A", "F"],
						}),
					),
				);
				page.send({ shortcut: "A", type: "page-shortcut-press" });
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>(
							objectContaining({
								type: "pick-entity-screen",
								schema: { slug: "item", owner: { kind: "plugin", pluginId: "fixture" } },
							}),
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"navigates to the configured plugin route instead of opening provider search",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({
					search: "search=ignored-query",
					settings: {
						...browserSettings,
						addAction: {
							type: "plugin-route",
							path: "/items/item-1",
							search: { tab: "history" },
							packageId: PluginPackageId.make("test/target"),
						},
					},
				});
				yield* Effect.promise(() => answerBrowser(page, answered, []));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { name: "No matches in All Items" })).toBeTruthy(),
					),
				);

				fireEvent.click(screen.getByRole("button", { name: /Search online for/ }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>({
							mode: "push",
							type: "navigate",
							target: {
								kind: "plugin-route",
								path: "/items/item-1",
								search: "tab=history",
								packageId: "test/target",
							},
						}),
					),
				);
				expect(page.clientMessages()).not.toContainEqual(
					objectContaining({ type: "pick-entity-screen" }),
				);
			}),
		testTimeout,
	);

	it.live(
		"counts every result on demand and reports the total beside the loaded count",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")], true, "cursor-1"),
				);

				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("1+ results")),
				);
				fireEvent.click(screen.getByRole("button", { name: "Count all" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("count")).toHaveLength(1)),
				);
				const count = page.queryRequests("count")[0];
				if (!count) {
					throw new Error("The count action never issued a request");
				}
				page.replyQuery(count.requestId, {
					outcome: "success",
					response: { data: { count: { type: "aggregate", items: [{ count: 42 }] } } },
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("1 of 42 results")),
				);
			}),
		testTimeout,
	);

	it.live(
		"shows each collection card's total member count",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openCollectionBrowser();
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [
						collectionBrowserRow("collection-1", "Favorites"),
						collectionBrowserRow("collection-2", "Empty"),
					]),
				);
				yield* Effect.promise(() =>
					waitFor(() => {
						expect(
							page.container?.querySelector('[data-entity-id="collection-1"]')?.textContent,
						).toContain("2 items");
						expect(
							page.container?.querySelector('[data-entity-id="collection-2"]')?.textContent,
						).toContain("0 items");
					}),
				);
				expect(page.queryRequests("savedView")).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"offers an online search that seeds the provider query when nothing matches",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ search: "search=example" });
				yield* Effect.promise(() => answerBrowser(page, answered, []));

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { name: "No matches in All Items" })).toBeTruthy(),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: /Search online for/ }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>(
							objectContaining({
								initialQuery: "example",
								type: "pick-entity-screen",
								schema: { slug: "item", owner: { kind: "plugin", pluginId: "fixture" } },
							}),
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"invites the first import from an empty view",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() => answerBrowser(page, answered, []));

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { name: "All Items is empty" })).toBeTruthy(),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: "Search online" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>(
							objectContaining({
								type: "pick-entity-screen",
								schema: { slug: "item", owner: { kind: "plugin", pluginId: "fixture" } },
							}),
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"builds table columns from settings instead of the first row",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ search: "layout=table" });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(2)),
				);
				expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
					"Name",
					"Year",
				]);
			}),
		testTimeout,
	);

	it.live(
		"hands the compact layout its own search row, options sheet, and add affordance",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				page.navigate(routeLocation("/v/all-items", ""), { compact: true });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);

				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(1)),
				);
				fireEvent.click(screen.getByRole("button", { name: "View options, 0 active filters" }));
				const sheet = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("dialog", { name: "View options" })),
				);
				expect(sheet.textContent).toContain("Add filter");

				fireEvent.click(screen.getByRole("button", { name: "Close view options" }));
				yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
				fireEvent.click(screen.getByRole("button", { name: "Search this view" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("searchbox", { name: "Search All Items" })).toBeTruthy(),
					),
				);
				expect(screen.getByRole("button", { name: "Exit search" })).toBeTruthy();
			}),
		testTimeout,
	);

	it.live(
		"debounces draft search for 300ms instead of querying per keystroke",
		() =>
			Effect.gen(function* () {
				const clock = testClock();
				const answered = new Set<string>();
				const page = openBrowser({ clock, search: "panel=details" });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				const search = screen.getByRole("searchbox", { name: "Search All Items" });

				fireEvent.change(search, { target: { value: "p" } });
				fireEvent.change(search, { target: { value: "pi" } });
				fireEvent.change(search, { target: { value: "pir" } });
				expect(page.queryRequests("savedView")).toHaveLength(1);
				yield* Effect.promise(() => clock.advance(299));
				expect(page.queryRequests("savedView")).toHaveLength(1);

				yield* Effect.promise(() => clock.advance(1));
				const request = yield* browserRequest(page, 1);
				expect(yield* encodeJson(request.request)).toContain("pir");
				replyBrowser(page, request.requestId, [browserRow("item-2", "Pirate Cinema")]);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual({
							mode: "replace",
							type: "page-search",
							update: { sort: null, filters: null, search: "pir" },
						}),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"preserves ongoing typing when a completed search is echoed through the URL",
		() =>
			Effect.gen(function* () {
				const clock = testClock();
				const page = openBrowser({ clock });
				const initial = yield* browserRequest(page, 0);
				replyBrowser(page, initial.requestId, []);
				const search = yield* Effect.promise(() =>
					screen.findByRole<HTMLInputElement>("searchbox", { name: "Search All Items" }),
				);
				search.focus();
				fireEvent.change(search, { target: { value: "the" } });
				yield* Effect.promise(() => clock.advance(300));
				const request = yield* browserRequest(page, 1);
				fireEvent.change(search, { target: { value: "the office" } });
				replyBrowser(page, request.requestId, []);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual({
							mode: "replace",
							type: "page-search",
							update: { sort: null, filters: null, search: "the" },
						}),
					),
				);
				page.navigate(routeLocation("/v/all-items", "search=the"));
				yield* Effect.promise(() => waitFor(() => expect(search.value).toBe("the office")));
				expect(document.activeElement).toBe(search);
				yield* Effect.promise(() => clock.advance(300));
				const next = yield* browserRequest(page, 2);
				expect(yield* encodeJson(next.request)).toContain("the office");
			}),
		testTimeout,
	);

	it.live(
		"keeps a newer committed search when an older URL update arrives",
		() =>
			Effect.gen(function* () {
				const clock = testClock();
				const page = openBrowser({ clock });
				const initial = yield* browserRequest(page, 0);
				replyBrowser(page, initial.requestId, []);
				const search = yield* Effect.promise(() =>
					screen.findByRole<HTMLInputElement>("searchbox", { name: "Search All Items" }),
				);
				fireEvent.change(search, { target: { value: "the" } });
				yield* Effect.promise(() => clock.advance(300));
				const first = yield* browserRequest(page, 1);
				replyBrowser(page, first.requestId, []);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual({
							mode: "replace",
							type: "page-search",
							update: { sort: null, filters: null, search: "the" },
						}),
					),
				);
				fireEvent.change(search, { target: { value: "the office" } });
				yield* Effect.promise(() => clock.advance(300));
				const second = yield* browserRequest(page, 2);
				page.navigate(routeLocation("/v/all-items", "search=the"));
				replyBrowser(page, second.requestId, []);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual({
							mode: "replace",
							type: "page-search",
							update: { sort: null, filters: null, search: "the office" },
						}),
					),
				);
				expect(search.value).toBe("the office");
				page.navigate(routeLocation("/v/all-items", "search=the+office"));
				page.navigate(routeLocation("/v/all-items", "search=the"));
				yield* Effect.promise(() => waitFor(() => expect(search.value).toBe("the")));
			}),
		testTimeout,
	);

	it.live(
		"commits Enter immediately and debounces clearing the draft",
		() =>
			Effect.gen(function* () {
				const clock = testClock();
				const answered = new Set<string>();
				const page = openBrowser({ clock });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				const search = screen.getByRole("searchbox", { name: "Search All Items" });

				fireEvent.change(search, { target: { value: "example" } });
				const form = search.closest("form");
				if (!form) {
					throw new Error("Search input is not inside its form");
				}
				fireEvent.submit(form);
				const searched = yield* browserRequest(page, 1);
				replyBrowser(page, searched.requestId, [browserRow("item-1", "Example")]);
				fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("searchbox", { name: "Search All Items" }).getAttribute("value"),
						).toBe(""),
					),
				);
				expect(page.queryRequests("savedView")).toHaveLength(2);

				yield* Effect.promise(() => clock.advance(300));
				yield* browserRequest(page, 2);
			}),
		testTimeout,
	);

	it.live(
		"keeps search focus through the committed query result lifecycle",
		() =>
			Effect.gen(function* () {
				const clock = testClock();
				const answered = new Set<string>();
				const page = openBrowser({ clock });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);
				const search = screen.getByRole("searchbox", { name: "Search All Items" });
				search.focus();
				fireEvent.change(search, { target: { value: "pir" } });

				yield* Effect.promise(() => clock.advance(300));
				const request = yield* browserRequest(page, 1);
				expect(document.activeElement).toBe(search);
				replyBrowser(page, request.requestId, [browserRow("item-2", "Pirate Cinema")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("Pirate Cinema")),
				);
				expect(document.activeElement).toBe(search);
			}),
		testTimeout,
	);

	it.live(
		"applies external URL search to both the draft and committed query",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ search: "panel=details" });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "Example")]),
				);

				page.navigate(routeLocation("/v/all-items", "panel=details&search=external"));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(
							screen.getByRole("searchbox", { name: "Search All Items" }).getAttribute("value"),
						).toBe("external"),
					),
				);
				const request = yield* browserRequest(page, 1);
				expect(yield* encodeJson(request.request)).toContain("external");
			}),
		testTimeout,
	);

	it.live(
		"requests one cursor page per load-more click and never before a click",
		() =>
			Effect.gen(function* () {
				const page = openBrowser();
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("item-1", "One")], true, "cursor-1");
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
					),
				);
				expect(page.queryRequests("savedView")).toHaveLength(1);

				fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
				const second = yield* browserRequest(page, 1);
				expect(
					screen.getByRole("button", { name: "Loading more results" }).getAttribute("aria-busy"),
				).toBe("true");
				expect(yield* encodeJson(second.request)).toContain("cursor-1");
				replyBrowser(page, second.requestId, [browserRow("item-2", "Two")], true, "cursor-2");
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("2+ results")),
				);
				expect(page.queryRequests("savedView")).toHaveLength(2);

				fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
				const third = yield* browserRequest(page, 2);
				expect(yield* encodeJson(third.request)).toContain("cursor-2");
			}),
		testTimeout,
	);

	it.live(
		"refreshes a one-page browser with exactly one page",
		() =>
			Effect.gen(function* () {
				const page = openBrowser();
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("item-1", "Original")], true, "cursor-1");
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("Original")),
				);

				page.send({ type: "page-refresh" });
				const refreshed = yield* browserRequest(page, 1);
				expect(page.container?.textContent).toContain("Original");
				expect(
					screen.getByRole("button", { name: "Load more results" }).getAttribute("aria-busy"),
				).toBeNull();
				expect(screen.queryByRole("button", { name: "Loading more results" })).toBeNull();
				replyBrowser(
					page,
					refreshed.requestId,
					[browserRow("item-2", "Refreshed")],
					true,
					"fresh-1",
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("Refreshed")),
				);
				expect(page.queryRequests("savedView")).toHaveLength(2);
			}),
		testTimeout,
	);

	it.live(
		"replays exactly the manually loaded page depth during refresh",
		() =>
			Effect.gen(function* () {
				const page = openBrowser();
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("item-1", "One")], true, "cursor-1");
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
				const second = yield* browserRequest(page, 1);
				replyBrowser(page, second.requestId, [browserRow("item-2", "Two")], true, "cursor-2");
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("2+ results")),
				);

				page.send({ type: "page-refresh" });
				const replayFirst = yield* browserRequest(page, 2);
				replyBrowser(
					page,
					replayFirst.requestId,
					[browserRow("item-1", "One updated")],
					true,
					"fresh-1",
				);
				const replaySecond = yield* browserRequest(page, 3);
				expect(yield* encodeJson(replaySecond.request)).toContain("fresh-1");
				replyBrowser(
					page,
					replaySecond.requestId,
					[browserRow("item-2", "Two updated")],
					true,
					"fresh-2",
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.container?.textContent).toContain("Two updated")),
				);
				expect(page.queryRequests("savedView")).toHaveLength(4);
			}),
		testTimeout,
	);

	it.live(
		"does not leak loaded state between mounts of the same saved view",
		() =>
			Effect.gen(function* () {
				const firstPage = openBrowser({ savedViewId: "shared-view" });
				const first = yield* browserRequest(firstPage, 0);
				replyBrowser(
					firstPage,
					first.requestId,
					[browserRow("item-old", "Old mount")],
					true,
					"old-1",
				);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
				const second = yield* browserRequest(firstPage, 1);
				replyBrowser(firstPage, second.requestId, [browserRow("item-old-2", "Old second page")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(firstPage.container?.textContent).toContain("Old second page")),
				);
				firstPage.dispose();

				const secondPage = openBrowser({ savedViewId: "shared-view" });
				expect(secondPage.container?.textContent).not.toContain("Old mount");
				const fresh = yield* browserRequest(secondPage, 0);
				replyBrowser(
					secondPage,
					fresh.requestId,
					[browserRow("item-new", "New mount")],
					true,
					"new-1",
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(secondPage.container?.textContent).toContain("New mount")),
				);
				secondPage.send({ type: "page-refresh" });
				const refresh = yield* browserRequest(secondPage, 1);
				replyBrowser(
					secondPage,
					refresh.requestId,
					[browserRow("item-new", "New mount refreshed")],
					true,
					"newer-1",
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(secondPage.container?.textContent).toContain("New mount refreshed")),
				);
				expect(secondPage.queryRequests("savedView")).toHaveLength(2);
			}),
		testTimeout,
	);
});

const statusRule = { field: "status", values: ["read"], operator: "anyOf" } as const;
const yearRule = { min: 1990, max: 2000, field: "year", operator: "between" } as const;

const filtersParam = (filter: unknown) =>
	`filters=${Buffer.from(JSON.stringify(filter)).toString("base64url")}`;

const pageSearchUpdates = (page: ReturnType<typeof mountPluginPage>) =>
	page.clientMessages().flatMap((message) => (message.type === "page-search" ? [message] : []));

const lastFiltersUpdate = (page: ReturnType<typeof mountPluginPage>) =>
	pageSearchUpdates(page)
		.map(({ update }) => update["filters"])
		.at(-1);

const decodeFiltersUpdate = (encoded: null | string | undefined): unknown =>
	typeof encoded === "string"
		? JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
		: encoded;

const openFilters = (name = "Filters") =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
		return yield* Effect.promise(() => waitFor(() => screen.getByRole("dialog", { name })));
	});

const selectBrowserSort = (label: string) =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("button", { name: /^Sort by/ }));
		fireEvent.click(yield* Effect.promise(() => screen.findByRole("radio", { name: label })));
		yield* Effect.promise(() =>
			waitFor(() => expect(screen.queryByRole("dialog", { name: "Sort by" })).toBeNull()),
		);
	});

const addFilter = (field: string, position = 1) =>
	Effect.gen(function* () {
		fireEvent.click(screen.getByRole("button", { name: /^Add filter/ }));
		fireEvent.click(
			yield* Effect.promise(() => waitFor(() => screen.getByRole("radio", { name: field }))),
		);
		return yield* Effect.promise(() =>
			waitFor(() => screen.getByRole("group", { name: `Filter ${position}` })),
		);
	});

const replyChoices = (
	page: ReturnType<typeof mountPluginPage>,
	requestId: string,
	items: readonly { readonly id: string; readonly name: string }[],
) =>
	page.replyQuery(requestId, {
		outcome: "success",
		response: {
			data: {
				choices: {
					type: "aggregate",
					items: items.map((item) => ({ ...item, links: 1 })),
					pageInfo: { limit: 50, hasMore: false, nextCursor: null },
				},
			},
		},
	});

describe("entity browser sorting", () => {
	afterEach(() => disposePluginBridges());

	it.live(
		"publishes a persisted-source sort only after a successful retry and restores it on navigation",
		() =>
			Effect.gen(function* () {
				const search = `keep=1&layout=table&search=sample&${filtersParam(statusRule)}`;
				const page = openBrowser({ search });
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("one", "Sample")]);
				yield* openFilters();
				yield* selectBrowserSort("Name");
				const sorted = yield* browserRequest(page, 1);
				expect(sorted.request).toEqual({ ...first.request, sort: "name-asc" });
				page.replyQuery(sorted.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					screen.findByText("The saved view results could not be loaded."),
				);
				expect(pageSearchUpdates(page)).toEqual([]);
				fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
				fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				const retried = yield* browserRequest(page, 2);
				expect(retried.request).toEqual(sorted.request);
				replyBrowser(page, retried.requestId, [browserRow("one", "Sample")]);
				yield* Effect.promise(() => waitFor(() => expect(pageSearchUpdates(page)).toHaveLength(1)));
				expect(pageSearchUpdates(page)[0]).toMatchObject({
					mode: "replace",
					update: { sort: "name-asc", search: "sample" },
				});
				expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual(statusRule);
				expect(Object.keys(pageSearchUpdates(page)[0]?.update ?? {}).sort()).toEqual([
					"filters",
					"search",
					"sort",
				]);
				const published = `${search}&sort=name-asc`;
				page.navigate(routeLocation("/v/all-items", published));
				yield* openFilters();
				fireEvent.click(screen.getByRole("button", { name: "Sort direction: A–Z" }));
				const descending = yield* browserRequest(page, 3);
				expect(descending.request).toEqual({ ...first.request, sort: "name-desc" });
				page.navigate(routeLocation("/v/all-items", search));
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Sort by: Default order" }),
				);
				replyBrowser(page, descending.requestId, [browserRow("two", "Sample Z")]);
				page.navigate(routeLocation("/v/all-items", published));
				yield* Effect.promise(() => screen.findByRole("button", { name: "Sort direction: A–Z" }));
				fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
				expect(screen.getByRole("radio", { name: "Table view" }).getAttribute("aria-checked")).toBe(
					"true",
				);
				expect(
					screen.getByRole("searchbox", { name: "Search All Items" }).getAttribute("value"),
				).toBe("sample");
				yield* waitForMessagePortMacrotask;
				expect(pageSearchUpdates(page)).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"selects one field, toggles direction, and uses the next field's preferred direction",
		() =>
			Effect.gen(function* () {
				const page = openBrowser({ search: `search=sample&${filtersParam(statusRule)}` });
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("one", "Sample")], true, "old-page");
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Load more results" })),
				);
				const second = yield* browserRequest(page, 1);
				replyBrowser(page, second.requestId, [browserRow("two", "Sample sequel")]);
				yield* Effect.promise(() => screen.findByText("2 results"));
				yield* openFilters();
				expect(
					screen.getByRole("button", { name: "Sort direction: Default" }).hasAttribute("disabled"),
				).toBe(true);
				fireEvent.click(screen.getByRole("button", { name: "Sort by: Default order" }));
				const dialog = yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Sort by" }),
				);
				expect(
					within(dialog)
						.getAllByRole("radio")
						.map((radio) => radio.textContent),
				).toEqual(["Default order", "Name", "Release year"]);
				fireEvent.click(screen.getByRole("radio", { name: "Release year" }));
				const descending = yield* browserRequest(page, 2);
				expect(descending.request).toMatchObject({
					sort: "year-desc",
					pages: { savedView: { limit: 2 } },
				});
				const encoded = yield* encodeJson(descending.request);
				expect(encoded).toContain("sample");
				expect(encoded).toContain('"read"');
				expect(encoded).not.toContain("old-page");
				replyBrowser(page, descending.requestId, [browserRow("three", "Sample latest")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(pageSearchUpdates(page).at(-1)?.update["sort"]).toBe("year-desc")),
				);
				expect(pageSearchUpdates(page).at(-1)?.update["search"]).toBe("sample");
				expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual(statusRule);
				expect(
					screen
						.getByRole("button", { name: "Sort direction: Newest first" })
						.querySelector('[data-app-icon="arrow-down"]'),
				).not.toBeNull();
				fireEvent.click(screen.getByRole("button", { name: "Sort direction: Newest first" }));
				const ascending = yield* browserRequest(page, 3);
				expect(ascending.request.sort).toBe("year-asc");
				replyBrowser(page, ascending.requestId, [browserRow("four", "Sample oldest")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(pageSearchUpdates(page).at(-1)?.update["sort"]).toBe("year-asc")),
				);
				yield* selectBrowserSort("Release year");
				expect(screen.getByRole("button", { name: "Sort direction: Oldest first" })).toBeTruthy();
				expect(
					screen
						.getByRole("button", { name: "Sort direction: Oldest first" })
						.querySelector('[data-app-icon="arrow-up"]'),
				).not.toBeNull();
				expect(page.queryRequests("savedView")).toHaveLength(4);
				yield* selectBrowserSort("Name");
				const named = yield* browserRequest(page, 4);
				expect(named.request.sort).toBe("name-asc");
				replyBrowser(page, named.requestId, [browserRow("five", "Sample A")]);
				yield* selectBrowserSort("Release year");
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Sort direction: Newest first" }),
				);
			}),
		testTimeout,
	);

	it.live(
		"restores URL direction in compact options and follows external navigation",
		() =>
			Effect.gen(function* () {
				const page = openBrowser({ search: "sort=year-asc" });
				page.navigate(routeLocation("/v/all-items", "sort=year-asc"), { compact: true });
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("one", "One")]);
				yield* openFilters("View options");
				expect(screen.getByRole("button", { name: "Sort by: Release year" })).toBeTruthy();
				fireEvent.click(screen.getByRole("button", { name: "Sort direction: Oldest first" }));
				const next = yield* browserRequest(page, 1);
				replyBrowser(page, next.requestId, [browserRow("two", "Two")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(pageSearchUpdates(page).at(-1)?.update["sort"]).toBe("year-desc")),
				);
				page.navigate(routeLocation("/v/all-items", "sort=name-desc"), { compact: true });
				yield* Effect.promise(() => screen.findByRole("button", { name: "Sort direction: Z–A" }));
				page.navigate(routeLocation("/v/all-items", "sort=missing-desc"), { compact: true });
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Sort by: Default order" }),
				);
				expect(
					screen.getByRole("button", { name: "Sort direction: Default" }).hasAttribute("disabled"),
				).toBe(true);
			}),
		testTimeout,
	);
});

describe("entity browser filters", () => {
	afterEach(() => disposePluginBridges());

	it.live(
		"shares the page and pending count across unrelated location and dialog updates",
		() =>
			Effect.gen(function* () {
				const search = filtersParam(statusRule);
				const page = openBrowser({ search });
				const first = yield* browserRequest(page, 0);
				replyBrowser(page, first.requestId, [browserRow("item-1", "One")], true, "cursor-1");
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Count all" })),
				);
				const count = yield* Effect.promise(() =>
					waitFor(() => {
						const request = page.queryRequests("count")[0];
						if (request === undefined) {
							throw new Error("Count request was not issued");
						}
						return request;
					}),
				);

				page.navigate(routeLocation("/v/all-items", `${search}&panel=details`));
				yield* openFilters();
				yield* waitForMessagePortMacrotask;
				expect(page.queryRequests("savedView")).toHaveLength(1);
				expect(page.queryRequests("count")).toHaveLength(1);
				expect(screen.getByRole("button", { name: "Counting..." })).toBeTruthy();

				page.replyQuery(count.requestId, {
					outcome: "success",
					response: { data: { count: { type: "aggregate", items: [{ count: 9 }] } } },
				});
				yield* Effect.promise(() => screen.findByText("1 of 9 results"));
				fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
				page.navigate(routeLocation("/v/all-items", search));
				yield* openFilters();
				yield* waitForMessagePortMacrotask;
				expect(page.queryRequests("savedView")).toHaveLength(1);
				expect(page.queryRequests("count")).toHaveLength(1);
				expect(screen.getByText("1 of 9 results")).toBeTruthy();
			}),
		testTimeout,
	);

	it.live(
		"applies a completed rule to the query, the URL and the accessible filter count",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* openFilters();
				yield* addFilter("Status");
				fireEvent.click(screen.getByRole("button", { name: "Status values" }));
				fireEvent.click(
					yield* Effect.promise(() =>
						waitFor(() => screen.getByRole("checkbox", { name: "Read" })),
					),
				);

				const filtered = yield* browserRequest(page, 1);
				const document = yield* encodeJson(filtered.request);
				expect(document).toContain('"read"');
				expect(document).toContain("status");
				replyBrowser(page, filtered.requestId, [browserRow("item-2", "Two")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual(statusRule)),
				);
				expect(pageSearchUpdates(page).at(-1)?.mode).toBe("replace");
				fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
				expect(screen.getByRole("button", { name: "Filters, 1 active filter" })).toBeTruthy();
				expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
					"Status is any of Read",
				);
			}),
		testTimeout,
	);

	it.live(
		"keeps an incomplete rule out of the query",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* openFilters();
				yield* addFilter("Year");
				expect(page.queryRequests("savedView")).toHaveLength(1);
				expect(lastFiltersUpdate(page)).toBeUndefined();
				expect(screen.getByRole("button", { name: "Filters, 0 active filters" })).toBeTruthy();
			}),
		testTimeout,
	);

	it.live(
		"removes a rule from its chip and clears every filter",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({
					search: filtersParam({ type: "and", filters: [statusRule, yearRule] }),
				});
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
							"Year is between 1990 and 2000",
						),
					),
				);
				expect(screen.getByRole("button", { name: "Filters, 2 active filters" })).toBeTruthy();

				fireEvent.click(screen.getByRole("button", { name: "Remove Status filter" }));
				const single = yield* browserRequest(page, 1);
				replyBrowser(page, single.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() =>
					waitFor(() => expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual(yearRule)),
				);

				fireEvent.click(screen.getByRole("button", { name: "Clear" }));
				const cleared = yield* browserRequest(page, 2);
				replyBrowser(page, cleared.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() => waitFor(() => expect(lastFiltersUpdate(page)).toBeNull()));
				expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"toggles the group between match all and match any",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({
					search: filtersParam({ type: "and", filters: [statusRule, yearRule] }),
				});
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* openFilters();
				fireEvent.click(screen.getByRole("radio", { name: "Match any" }));
				const request = yield* browserRequest(page, 1);
				replyBrowser(page, request.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual({
							type: "or",
							filters: [statusRule, yearRule],
						}),
					),
				);
				fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
				expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
					"Match any",
				);
			}),
		testTimeout,
	);

	it.live(
		"offers Clear filters when the applied filters match nothing",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ search: filtersParam(statusRule) });
				yield* Effect.promise(() => answerBrowser(page, answered, []));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { name: "No matches in All Items" })).toBeTruthy(),
					),
				);
				expect(page.container?.textContent).toContain("match the current filters");
				fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
				const request = yield* browserRequest(page, 1);
				replyBrowser(page, request.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() => waitFor(() => expect(lastFiltersUpdate(page)).toBeNull()));
			}),
		testTimeout,
	);

	it.live(
		"sends the applied filter with Count all",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({ search: filtersParam(statusRule) });
				yield* Effect.promise(() =>
					answerBrowser(page, answered, [browserRow("item-1", "One")], true, "cursor-1"),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: "Count all" })).toBeTruthy()),
				);
				fireEvent.click(screen.getByRole("button", { name: "Count all" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("count")).toHaveLength(1)),
				);
				const count = page.queryRequests("count")[0];
				const document = yield* encodeJson(count?.request);
				expect(document).toContain('"read"');
				expect(document).toContain("status");
			}),
		testTimeout,
	);

	it.live(
		"shows a nested filter as one removable custom chip",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({
					search: filtersParam({
						type: "and",
						filters: [statusRule, { type: "or", filters: [yearRule, statusRule] }],
					}),
				});
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: "Custom filter" })).toBeTruthy()),
				);
				expect(screen.getByRole("button", { name: "Filters, 1 active filter" })).toBeTruthy();
				fireEvent.click(screen.getByRole("button", { name: "Remove custom filter" }));
				const request = yield* browserRequest(page, 1);
				replyBrowser(page, request.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() => waitFor(() => expect(lastFiltersUpdate(page)).toBeNull()));
			}),
		testTimeout,
	);

	it.live(
		"labels relationship chips with resolved names and the count form while pending",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser({
					search: filtersParam({ field: "authors", operator: "anyOf", values: ["p-1", "p-2"] }),
				});
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				const lookup = yield* Effect.promise(() =>
					waitFor(() => {
						const found = page.queryRequests("choices").at(-1);
						if (!found) {
							throw new Error("No choices lookup was issued");
						}
						return found;
					}),
				);
				const document = yield* encodeJson(lookup.request);
				expect(document).toContain("p-1");
				expect(document).toContain("p-2");
				expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
					"Authors: 2 selected",
				);
				expect(page.container?.textContent).not.toContain("p-1");
				replyChoices(page, lookup.requestId, [
					{ id: "p-1", name: "Ann" },
					{ id: "p-2", name: "Bo" },
				]);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
							"Authors includes any of Ann, Bo",
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"lists relationship choices from the choices recipe in the rule editor",
		() =>
			Effect.gen(function* () {
				const answered = new Set<string>();
				const page = openBrowser();
				yield* Effect.promise(() => answerBrowser(page, answered, [browserRow("item-1", "One")]));
				yield* openFilters();
				yield* addFilter("Authors");
				fireEvent.click(screen.getByRole("button", { name: /^Authors values/ }));
				const lookup = yield* Effect.promise(() =>
					waitFor(() => {
						const found = page.queryRequests("choices").at(-1);
						if (!found) {
							throw new Error("No choices request");
						}
						return found;
					}),
				);
				replyChoices(page, lookup.requestId, [{ id: "p-1", name: "Ann" }]);
				fireEvent.click(
					yield* Effect.promise(() => waitFor(() => screen.getByRole("checkbox", { name: "Ann" }))),
				);
				const request = yield* browserRequest(page, 1);
				replyBrowser(page, request.requestId, [browserRow("item-1", "One")]);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(decodeFiltersUpdate(lastFiltersUpdate(page))).toEqual({
							values: ["p-1"],
							field: "authors",
							operator: "anyOf",
						}),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"offers the automatic Collections field on a collection browser",
		() =>
			Effect.gen(function* () {
				const page = openCollectionBrowser();
				const request = yield* browserRequest(page, 0);
				replyBrowser(page, request.requestId, [collectionBrowserRow("c-1", "Favorites")]);
				yield* openFilters();
				const rule = yield* addFilter("Collections");
				expect(rule.textContent).toContain("Collections");
			}),
		testTimeout,
	);
});
