// @vitest-environment jsdom
import {
	disposePluginBridges,
	createTestRyotClock,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

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
	} = {},
) => {
	views += 1;
	const page = mountPluginPage(EntityBrowserPage, {
		location: routeLocation("/v/all-books", options.search ?? ""),
		page: savedViewPageContext({
			rendererName: "entity-browser",
			dataSources: browserDataSources,
			view: { name: "All Books", icon: "book" },
			settings: options.settings ?? browserSettings,
			savedViewId: options.savedViewId ?? `view-${views}`,
		}),
	});
	return page;
};

const testClock = () => {
	const clock = createTestRyotClock();
	clocks.push(clock);
	return clock;
};

const browserRequest = async (page: ReturnType<typeof mountPluginPage>, index: number) => {
	await waitFor(() => expect(page.queryRequests("entityBrowser").length).toBeGreaterThan(index));
	const request = page.queryRequests("entityBrowser")[index];
	if (!request) {
		throw new Error(`Entity browser request ${index} was not issued`);
	}
	return request;
};

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

const answerBrowser = async (
	page: ReturnType<typeof mountPluginPage>,
	answered: Set<string>,
	items: readonly Record<string, unknown>[],
	hasMore = false,
	nextCursor: string | null = null,
) => {
	await waitFor(() => {
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
};

describe("entity browser", () => {
	afterEach(async () => {
		disposePluginBridges();
		await Promise.all(clocks.splice(0).map((clock) => clock.dispose()));
	});

	it("titles the screen with the saved view and announces its shipped chrome", async () => {
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);
		await waitFor(() => expect(page.container?.textContent).toContain("1 result"));

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "All Books" })).toBeTruthy(),
		);
		const search = screen.getByRole("searchbox", { name: "Search All Books" });
		expect(search.getAttribute("aria-keyshortcuts")).toBe("/");
		const filters = screen.getByRole("button", { name: /Filters/ });
		expect(filters.getAttribute("aria-disabled")).toBe("true");
		expect(filters.textContent).toContain("0");
		const add = screen.getByRole("button", { name: "Add" });
		expect(add.getAttribute("aria-keyshortcuts")).toBe("A");
		expect(screen.getByRole("radio", { name: "Grid view" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Table view" })).toBeTruthy();
	});

	it("registers its page shortcuts upward and opens provider search on a kernel press", async () => {
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);

		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				shortcuts: ["/", "A"],
				type: "page-shortcuts",
			}),
		);
		page.send({ shortcut: "A", type: "page-shortcut-press" });
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				ownerPluginId: "media",
				entitySchemaSlug: "book",
				type: "provider-search-screen",
			}),
		);
	});

	it("counts every result on demand and reports the total beside the loaded count", async () => {
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")], true, "cursor-1");

		await waitFor(() => expect(page.container?.textContent).toContain("1+ results"));
		fireEvent.click(screen.getByRole("button", { name: "Count all" }));
		await waitFor(() => expect(page.queryRequests("entityBrowserCount")).toHaveLength(1));
		const count = page.queryRequests("entityBrowserCount")[0];
		if (!count) {
			throw new Error("The count action never issued a request");
		}
		page.replyQuery(count.requestId, {
			outcome: "success",
			response: { data: { entityBrowserCount: { type: "aggregate", items: [{ total: 42 }] } } },
		});
		await waitFor(() => expect(page.container?.textContent).toContain("1 of 42 results"));
	});

	it("offers an online search that seeds the provider query when nothing matches", async () => {
		const answered = new Set<string>();
		const page = openBrowser({ search: "search=piranesi" });
		await answerBrowser(page, answered, []);

		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "No matches in All Books" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: /Search online for/ }));
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				ownerPluginId: "media",
				initialQuery: "piranesi",
				entitySchemaSlug: "book",
				type: "provider-search-screen",
			}),
		);
	});

	it("invites the first import from an empty view", async () => {
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, []);

		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "All Books is empty" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Search online" }));
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				ownerPluginId: "media",
				entitySchemaSlug: "book",
				type: "provider-search-screen",
			}),
		);
	});

	it("builds table columns from settings instead of the first row", async () => {
		const answered = new Set<string>();
		const page = openBrowser({ search: "layout=table" });
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);
		await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(2));
		expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
			"Name",
			"Year",
		]);
	});

	it("hands the compact layout its own search row, options sheet, and add affordance", async () => {
		const answered = new Set<string>();
		const page = openBrowser();
		page.navigate(routeLocation("/v/all-books", ""), { compact: true });
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add to this view" })).toBeTruthy(),
		);
		expect(screen.queryByRole("button", { name: /^Add$/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "View options, 0 active filters" }));
		const sheet = await waitFor(() => screen.getByRole("dialog", { name: "View options" }));
		expect(sheet.textContent).toContain("Filters are not available yet.");

		fireEvent.click(screen.getByRole("button", { name: "Close view options" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Search this view" }));
		await waitFor(() =>
			expect(screen.getByRole("searchbox", { name: "Search All Books" })).toBeTruthy(),
		);
		expect(screen.getByRole("button", { name: "Exit search" })).toBeTruthy();
	});

	it("debounces draft search for 300ms instead of querying per keystroke", async () => {
		const clock = testClock();
		const answered = new Set<string>();
		const page = openBrowser({ search: "panel=details" });
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);
		const search = screen.getByRole("searchbox", { name: "Search All Books" });

		fireEvent.change(search, { target: { value: "p" } });
		fireEvent.change(search, { target: { value: "pi" } });
		fireEvent.change(search, { target: { value: "pir" } });
		expect(page.queryRequests("entityBrowser")).toHaveLength(1);
		await clock.advance(299);
		expect(page.queryRequests("entityBrowser")).toHaveLength(1);

		await clock.advance(1);
		const request = await browserRequest(page, 1);
		expect(JSON.stringify(request.document)).toContain("pir");
		replyBrowser(page, request.requestId, [browserRow("book-2", "Pirate Cinema")]);
		await waitFor(() =>
			expect(page.clientMessages()).toContainEqual({
				mode: "replace",
				type: "page-search",
				update: { search: "pir", sort: null },
			}),
		);
	});

	it("commits Enter immediately and debounces clearing the draft", async () => {
		const clock = testClock();
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);
		const search = screen.getByRole("searchbox", { name: "Search All Books" });

		fireEvent.change(search, { target: { value: "piranesi" } });
		const form = search.closest("form");
		if (!form) {
			throw new Error("Search input is not inside its form");
		}
		fireEvent.submit(form);
		const searched = await browserRequest(page, 1);
		replyBrowser(page, searched.requestId, [browserRow("book-1", "Piranesi")]);
		fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
		await waitFor(() =>
			expect(
				screen.getByRole("searchbox", { name: "Search All Books" }).getAttribute("value"),
			).toBe(""),
		);
		expect(page.queryRequests("entityBrowser")).toHaveLength(2);

		await clock.advance(300);
		await browserRequest(page, 2);
	});

	it("keeps search focus through the committed query result lifecycle", async () => {
		const clock = testClock();
		const answered = new Set<string>();
		const page = openBrowser();
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);
		const search = screen.getByRole("searchbox", { name: "Search All Books" });
		search.focus();
		fireEvent.change(search, { target: { value: "pir" } });

		await clock.advance(300);
		const request = await browserRequest(page, 1);
		expect(document.activeElement).toBe(search);
		replyBrowser(page, request.requestId, [browserRow("book-2", "Pirate Cinema")]);
		await waitFor(() => expect(page.container?.textContent).toContain("Pirate Cinema"));
		expect(document.activeElement).toBe(search);
	});

	it("applies external URL search to both the draft and committed query", async () => {
		const answered = new Set<string>();
		const page = openBrowser({ search: "panel=details" });
		await answerBrowser(page, answered, [browserRow("book-1", "Piranesi")]);

		page.navigate(routeLocation("/v/all-books", "panel=details&search=external"));
		await waitFor(() =>
			expect(
				screen.getByRole("searchbox", { name: "Search All Books" }).getAttribute("value"),
			).toBe("external"),
		);
		const request = await browserRequest(page, 1);
		expect(JSON.stringify(request.document)).toContain("external");
	});

	it("requests one cursor page per load-more click and never before a click", async () => {
		const page = openBrowser();
		const first = await browserRequest(page, 0);
		replyBrowser(page, first.requestId, [browserRow("book-1", "One")], true, "cursor-1");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
		);
		expect(page.queryRequests("entityBrowser")).toHaveLength(1);

		fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
		const second = await browserRequest(page, 1);
		expect(JSON.stringify(second.document)).toContain("cursor-1");
		replyBrowser(page, second.requestId, [browserRow("book-2", "Two")], true, "cursor-2");
		await waitFor(() => expect(page.container?.textContent).toContain("2+ results"));
		expect(page.queryRequests("entityBrowser")).toHaveLength(2);

		fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
		const third = await browserRequest(page, 2);
		expect(JSON.stringify(third.document)).toContain("cursor-2");
	});

	it("refreshes a one-page browser with exactly one page", async () => {
		const page = openBrowser();
		const first = await browserRequest(page, 0);
		replyBrowser(page, first.requestId, [browserRow("book-1", "Original")], true, "cursor-1");
		await waitFor(() => expect(page.container?.textContent).toContain("Original"));

		page.send({ type: "page-refresh" });
		const refreshed = await browserRequest(page, 1);
		replyBrowser(page, refreshed.requestId, [browserRow("book-2", "Refreshed")], true, "fresh-1");
		await waitFor(() => expect(page.container?.textContent).toContain("Refreshed"));
		expect(page.queryRequests("entityBrowser")).toHaveLength(2);
	});

	it("replays exactly the manually loaded page depth during refresh", async () => {
		const page = openBrowser();
		const first = await browserRequest(page, 0);
		replyBrowser(page, first.requestId, [browserRow("book-1", "One")], true, "cursor-1");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
		const second = await browserRequest(page, 1);
		replyBrowser(page, second.requestId, [browserRow("book-2", "Two")], true, "cursor-2");
		await waitFor(() => expect(page.container?.textContent).toContain("2+ results"));

		page.send({ type: "page-refresh" });
		const replayFirst = await browserRequest(page, 2);
		replyBrowser(
			page,
			replayFirst.requestId,
			[browserRow("book-1", "One updated")],
			true,
			"fresh-1",
		);
		const replaySecond = await browserRequest(page, 3);
		expect(JSON.stringify(replaySecond.document)).toContain("fresh-1");
		replyBrowser(
			page,
			replaySecond.requestId,
			[browserRow("book-2", "Two updated")],
			true,
			"fresh-2",
		);
		await waitFor(() => expect(page.container?.textContent).toContain("Two updated"));
		expect(page.queryRequests("entityBrowser")).toHaveLength(4);
	});

	it("does not leak loaded state between mounts of the same saved view", async () => {
		const firstPage = openBrowser({ savedViewId: "shared-view" });
		const first = await browserRequest(firstPage, 0);
		replyBrowser(firstPage, first.requestId, [browserRow("book-old", "Old mount")], true, "old-1");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Load more results" })).toBeTruthy(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Load more results" }));
		const second = await browserRequest(firstPage, 1);
		replyBrowser(firstPage, second.requestId, [browserRow("book-old-2", "Old second page")]);
		await waitFor(() => expect(firstPage.container?.textContent).toContain("Old second page"));
		firstPage.dispose();

		const secondPage = openBrowser({ savedViewId: "shared-view" });
		expect(secondPage.container?.textContent).not.toContain("Old mount");
		const fresh = await browserRequest(secondPage, 0);
		replyBrowser(secondPage, fresh.requestId, [browserRow("book-new", "New mount")], true, "new-1");
		await waitFor(() => expect(secondPage.container?.textContent).toContain("New mount"));
		secondPage.send({ type: "page-refresh" });
		const refresh = await browserRequest(secondPage, 1);
		replyBrowser(
			secondPage,
			refresh.requestId,
			[browserRow("book-new", "New mount refreshed")],
			true,
			"newer-1",
		);
		await waitFor(() => expect(secondPage.container?.textContent).toContain("New mount refreshed"));
		expect(secondPage.queryRequests("entityBrowser")).toHaveLength(2);
	});
});
