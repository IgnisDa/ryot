import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	defineEntityPresentation,
	type EntityPresentationRegistration,
} from "@ryot-app/client-sdk/plugin";
import {
	disposePluginBridges,
	createTestRyotClock,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { Effect, Result, Schema } from "effect";

import CollectionBrowserPage from "./collection-browser";
import EntityBrowserPage from "./entity-browser";
import {
	browserDataSources,
	browserPage,
	browserRow,
	browserSettings,
} from "./fixtures/saved-view";

let views = 0;
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

const openBrowser = (
	options: {
		readonly search?: string;
		readonly savedViewId?: string;
		readonly settings?: Record<string, unknown>;
		readonly clock?: ReturnType<typeof createTestRyotClock>;
		readonly entityPresentations?: readonly EntityPresentationRegistration[];
	} = {},
) => {
	views += 1;
	const page = mountPluginPage(EntityBrowserPage, {
		bootstrap: options.clock?.bootstrap,
		entityPresentations: options.entityPresentations,
		location: routeLocation("/v/all-books", options.search ?? ""),
		page: savedViewPageContext({
			rendererName: "entity-browser",
			dataSources: browserDataSources,
			view: { icon: "book", name: "All Books" },
			settings: options.settings ?? browserSettings,
			savedViewId: options.savedViewId ?? `view-${views}`,
		}),
	});
	return page;
};

const openCollectionBrowser = () => {
	views += 1;
	return mountPluginPage(CollectionBrowserPage, {
		location: routeLocation("/v/collections"),
		page: savedViewPageContext({
			settings: browserSettings,
			dataSources: browserDataSources,
			rendererName: "collection-browser",
			savedViewId: `collection-view-${views}`,
			view: { icon: "library", name: "All Collections" },
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
			waitFor(() => expect(page.queryRequests("entityBrowser").length).toBeGreaterThan(index)),
		);
		const request = page.queryRequests("entityBrowser")[index];
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
	nextCursor: string | null = null,
) =>
	page.replyQuery(requestId, {
		outcome: "success",
		response: browserPage(items, hasMore, nextCursor),
	});

const collectionBrowserRow = (entityId: string, name: string) => ({
	...browserRow(entityId, name),
	ownerPluginId: null,
	entitySchemaSlug: "collection",
	presentationMemberCount: name === "Favorites" ? 2 : 0,
});

const answerBrowser = (
	page: ReturnType<typeof mountPluginPage>,
	answered: Set<string>,
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: string | null = null,
) =>
	waitFor(() => {
		const pending = page
			.queryRequests("entityBrowser")
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

	it.live("titles the screen with the saved view and announces its shipped chrome", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser();
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 result")),
			);

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { level: 1, name: "All Books" })).toBeTruthy(),
				),
			);
			const search = screen.getByRole("searchbox", { name: "Search All Books" });
			expect(search.getAttribute("aria-keyshortcuts")).toBe("/");
			const filters = screen.getByRole("button", { name: /Filters/ });
			expect(filters.hasAttribute("disabled")).toBe(false);
			expect(filters.textContent).toContain("0");
			expect(screen.queryByRole("button", { name: /^Sort results/ })).toBeNull();
			const add = screen.getByRole("button", { name: "Add" });
			expect(add.getAttribute("aria-keyshortcuts")).toBe("A");
			expect(screen.getByRole("radio", { name: "Grid view" })).toBeTruthy();
			expect(screen.getByRole("radio", { name: "Table view" })).toBeTruthy();
			fireEvent.click(filters);
			const dialog = yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("dialog", { name: "Filters" })),
			);
			expect(dialog.textContent).toContain("Filters are not available yet.");
			expect(screen.queryByRole("button", { name: /^Sort results/ })).toBeNull();
			expect(dialog.textContent).not.toContain("View as");
		}),
	);

	it.live("renders plugin presentation data from the ordered browser request", () =>
		Effect.gen(function* () {
			const presentation = defineEntityPresentation<string>({
				component: ({ data }) => <p>{`Presented ${data}`}</p>,
				loader: () => Effect.die("Embedded presentation should not load"),
				prepare: ({ sources, references }) =>
					Result.all(
						Object.fromEntries(
							references.map(({ entityId }) => {
								const value = sources.get(entityId)?.["column0"];
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
						ownerPluginId: "media",
						entitySchemaSlug: "book",
						load: () => Promise.resolve(presentation),
					},
				],
			});
			const request = yield* browserRequest(page, 0);
			replyBrowser(page, request.requestId, [
				browserRow("book-2", "Second"),
				browserRow("book-1", "First"),
			]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.container?.textContent).toContain("Presented SecondPresented First"),
				),
			);
			expect(page.queryRequests()).toHaveLength(1);
		}),
	);

	it.live("registers its page shortcuts upward and opens provider search on a kernel press", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser();
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						shortcuts: ["/", "A"],
						type: "page-shortcuts",
					}),
				),
			);
			page.send({ shortcut: "A", type: "page-shortcut-press" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						ownerPluginId: "media",
						entitySchemaSlug: "book",
						type: "provider-search-screen",
					}),
				),
			);
		}),
	);

	it.live("counts every result on demand and reports the total beside the loaded count", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser();
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")], true, "cursor-1"),
			);

			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1+ results")),
			);
			fireEvent.click(screen.getByRole("button", { name: "Count all" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(page.queryRequests("entityBrowserCount")).toHaveLength(1)),
			);
			const count = page.queryRequests("entityBrowserCount")[0];
			if (!count) {
				throw new Error("The count action never issued a request");
			}
			page.replyQuery(count.requestId, {
				outcome: "success",
				response: { data: { entityBrowserCount: { type: "aggregate", items: [{ total: 42 }] } } },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 of 42 results")),
			);
		}),
	);

	it.live("shows each collection card's total member count", () =>
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
			expect(page.queryRequests()).toHaveLength(1);
		}),
	);

	it.live("offers an online search that seeds the provider query when nothing matches", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser({ search: "search=piranesi" });
			yield* Effect.promise(() => answerBrowser(page, answered, []));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { name: "No matches in All Books" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: /Search online for/ }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						ownerPluginId: "media",
						initialQuery: "piranesi",
						entitySchemaSlug: "book",
						type: "provider-search-screen",
					}),
				),
			);
		}),
	);

	it.live("invites the first import from an empty view", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser();
			yield* Effect.promise(() => answerBrowser(page, answered, []));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { name: "All Books is empty" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Search online" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						ownerPluginId: "media",
						entitySchemaSlug: "book",
						type: "provider-search-screen",
					}),
				),
			);
		}),
	);

	it.live("builds table columns from settings instead of the first row", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser({ search: "layout=table" });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(2)),
			);
			expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
				"Name",
				"Year",
			]);
		}),
	);

	it.live("hands the compact layout its own search row, options sheet, and add affordance", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser();
			page.navigate(routeLocation("/v/all-books", ""), { compact: true });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Add to this view" })).toBeTruthy(),
				),
			);
			expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "View options, 0 active filters" }));
			const sheet = yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("dialog", { name: "View options" })),
			);
			expect(sheet.textContent).toContain("Filters are not available yet.");

			fireEvent.click(screen.getByRole("button", { name: "Close view options" }));
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
			fireEvent.click(screen.getByRole("button", { name: "Search this view" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("searchbox", { name: "Search All Books" })).toBeTruthy(),
				),
			);
			expect(screen.getByRole("button", { name: "Exit search" })).toBeTruthy();
		}),
	);

	it.live("debounces draft search for 300ms instead of querying per keystroke", () =>
		Effect.gen(function* () {
			const clock = testClock();
			const answered = new Set<string>();
			const page = openBrowser({ clock, search: "panel=details" });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);
			const search = screen.getByRole("searchbox", { name: "Search All Books" });

			fireEvent.change(search, { target: { value: "p" } });
			fireEvent.change(search, { target: { value: "pi" } });
			fireEvent.change(search, { target: { value: "pir" } });
			expect(page.queryRequests("entityBrowser")).toHaveLength(1);
			yield* Effect.promise(() => clock.advance(299));
			expect(page.queryRequests("entityBrowser")).toHaveLength(1);

			yield* Effect.promise(() => clock.advance(1));
			const request = yield* browserRequest(page, 1);
			expect(yield* encodeJson(request.document)).toContain("pir");
			replyBrowser(page, request.requestId, [browserRow("book-2", "Pirate Cinema")]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.clientMessages()).toContainEqual({
						mode: "replace",
						type: "page-search",
						update: { sort: null, search: "pir" },
					}),
				),
			);
		}),
	);

	it.live("commits Enter immediately and debounces clearing the draft", () =>
		Effect.gen(function* () {
			const clock = testClock();
			const answered = new Set<string>();
			const page = openBrowser({ clock });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);
			const search = screen.getByRole("searchbox", { name: "Search All Books" });

			fireEvent.change(search, { target: { value: "piranesi" } });
			const form = search.closest("form");
			if (!form) {
				throw new Error("Search input is not inside its form");
			}
			fireEvent.submit(form);
			const searched = yield* browserRequest(page, 1);
			replyBrowser(page, searched.requestId, [browserRow("book-1", "Piranesi")]);
			fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("searchbox", { name: "Search All Books" }).getAttribute("value"),
					).toBe(""),
				),
			);
			expect(page.queryRequests("entityBrowser")).toHaveLength(2);

			yield* Effect.promise(() => clock.advance(300));
			yield* browserRequest(page, 2);
		}),
	);

	it.live("keeps search focus through the committed query result lifecycle", () =>
		Effect.gen(function* () {
			const clock = testClock();
			const answered = new Set<string>();
			const page = openBrowser({ clock });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);
			const search = screen.getByRole("searchbox", { name: "Search All Books" });
			search.focus();
			fireEvent.change(search, { target: { value: "pir" } });

			yield* Effect.promise(() => clock.advance(300));
			const request = yield* browserRequest(page, 1);
			expect(document.activeElement).toBe(search);
			replyBrowser(page, request.requestId, [browserRow("book-2", "Pirate Cinema")]);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Pirate Cinema")),
			);
			expect(document.activeElement).toBe(search);
		}),
	);

	it.live("applies external URL search to both the draft and committed query", () =>
		Effect.gen(function* () {
			const answered = new Set<string>();
			const page = openBrowser({ search: "panel=details" });
			yield* Effect.promise(() =>
				answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]),
			);

			page.navigate(routeLocation("/v/all-books", "panel=details&search=external"));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("searchbox", { name: "Search All Books" }).getAttribute("value"),
					).toBe("external"),
				),
			);
			const request = yield* browserRequest(page, 1);
			expect(yield* encodeJson(request.document)).toContain("external");
		}),
	);

	it.live("requests one cursor page per load-more click and never before a click", () =>
		Effect.gen(function* () {
			const page = openBrowser();
			const first = yield* browserRequest(page, 0);
			replyBrowser(page, first.requestId, [browserRow("book-1", "One")], true, "cursor-1");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
				),
			);
			expect(page.queryRequests("entityBrowser")).toHaveLength(1);

			fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
			const second = yield* browserRequest(page, 1);
			expect(yield* encodeJson(second.document)).toContain("cursor-1");
			replyBrowser(page, second.requestId, [browserRow("book-2", "Two")], true, "cursor-2");
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("2+ results")),
			);
			expect(page.queryRequests("entityBrowser")).toHaveLength(2);

			fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
			const third = yield* browserRequest(page, 2);
			expect(yield* encodeJson(third.document)).toContain("cursor-2");
		}),
	);

	it.live("refreshes a one-page browser with exactly one page", () =>
		Effect.gen(function* () {
			const page = openBrowser();
			const first = yield* browserRequest(page, 0);
			replyBrowser(page, first.requestId, [browserRow("book-1", "Original")], true, "cursor-1");
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Original")),
			);

			page.send({ type: "page-refresh" });
			const refreshed = yield* browserRequest(page, 1);
			replyBrowser(page, refreshed.requestId, [browserRow("book-2", "Refreshed")], true, "fresh-1");
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Refreshed")),
			);
			expect(page.queryRequests("entityBrowser")).toHaveLength(2);
		}),
	);

	it.live("replays exactly the manually loaded page depth during refresh", () =>
		Effect.gen(function* () {
			const page = openBrowser();
			const first = yield* browserRequest(page, 0);
			replyBrowser(page, first.requestId, [browserRow("book-1", "One")], true, "cursor-1");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
			const second = yield* browserRequest(page, 1);
			replyBrowser(page, second.requestId, [browserRow("book-2", "Two")], true, "cursor-2");
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("2+ results")),
			);

			page.send({ type: "page-refresh" });
			const replayFirst = yield* browserRequest(page, 2);
			replyBrowser(
				page,
				replayFirst.requestId,
				[browserRow("book-1", "One updated")],
				true,
				"fresh-1",
			);
			const replaySecond = yield* browserRequest(page, 3);
			expect(yield* encodeJson(replaySecond.document)).toContain("fresh-1");
			replyBrowser(
				page,
				replaySecond.requestId,
				[browserRow("book-2", "Two updated")],
				true,
				"fresh-2",
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("Two updated")),
			);
			expect(page.queryRequests("entityBrowser")).toHaveLength(4);
		}),
	);

	it.live("does not leak loaded state between mounts of the same saved view", () =>
		Effect.gen(function* () {
			const firstPage = openBrowser({ savedViewId: "shared-view" });
			const first = yield* browserRequest(firstPage, 0);
			replyBrowser(
				firstPage,
				first.requestId,
				[browserRow("book-old", "Old mount")],
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
			replyBrowser(firstPage, second.requestId, [browserRow("book-old-2", "Old second page")]);
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
				[browserRow("book-new", "New mount")],
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
				[browserRow("book-new", "New mount refreshed")],
				true,
				"newer-1",
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(secondPage.container?.textContent).toContain("New mount refreshed")),
			);
			expect(secondPage.queryRequests("entityBrowser")).toHaveLength(2);
		}),
	);
});
