import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { ClientPageContext } from "@ryot-app/plugin-client-contract";
import {
	createTestRyotClock,
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	waitForMessagePortMacrotask,
} from "@ryot-app/plugin-client-sdk/testing";
import { castDate, castJson, column, field, jsonPath, literal, table } from "@ryot-app/ryotql";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { Effect, Schema } from "effect";

import CalendarPage, { MAX_SOURCE_OCCURRENCES } from "./calendar";

type Page = ReturnType<typeof mountPluginPage>;

const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

afterEach(() => {
	disposePluginBridges();
	for (const clock of clocks.splice(0)) {
		void clock.dispose();
	}
});

const calendarContext = Schema.decodeSync(ClientPageContext)({
	settings: {},
	contributors: [],
	dataSources: null,
	route: { params: {} },
	view: { icon: "calendar", name: "Calendar" },
	renderer: { kind: "kernel", name: "Calendar" },
	target: { kind: "saved-view", reference: { kind: "kernel", slug: "calendar" } },
});

const source = (
	alias: string,
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => {
	const entity = table("entity", alias);
	return {
		art: "art",
		icon: "box",
		slug: alias,
		done: "done",
		startAt: "at",
		isHidden: false,
		precision: "date",
		caption: "caption",
		pluginId: "plugin-1",
		pluginName: "Workspace",
		name: `${alias} source`,
		subject: {
			entityAlias: alias,
			schemas: [{ slug: alias, owner: { kind: "plugin", pluginId: "plugin-1" } }],
		},
		query: {
			from: entity,
			output: {
				type: "rows",
				fields: [
					field("at", castDate(jsonPath(column(entity, "properties"), "at"))),
					field("caption", jsonPath(column(entity, "properties"), "caption")),
					field("art", castJson(jsonPath(column(entity, "properties"), "art"))),
					field("done", literal(false)),
				],
			},
		},
		...overrides,
	};
};

const occurrence = (
	subject: string,
	at: string,
	caption: null | string,
	extra: Readonly<Record<string, unknown>> = {},
) => ({
	at,
	caption,
	art: null,
	done: false,
	__calendarSubjectName: subject,
	__calendarSubjectSchema: "record",
	__calendarSubjectOwner: "plugin-1",
	__calendarSubjectId: `id-${subject}`,
	...extra,
});

const rows = (
	items: readonly Readonly<Record<string, unknown>>[],
	nextCursor: null | string = null,
) => ({
	items: [...items],
	type: "rows" as const,
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});

const pageClocks = new WeakMap<Page, ReturnType<typeof createTestRyotClock>>();

const open = (options: {
	readonly now: number;
	readonly search?: string;
	readonly compact?: boolean;
}) =>
	Effect.gen(function* () {
		const clock = createTestRyotClock();
		clocks.push(clock);
		yield* Effect.promise(() => clock.setTime(options.now));
		const page = mountPluginPage(CalendarPage, {
			page: calendarContext,
			bootstrap: clock.bootstrap,
		});
		pageClocks.set(page, clock);
		page.navigate(routeLocation("/v/k/calendar", options.search ?? ""), {
			compact: options.compact ?? false,
		});
		return page;
	});

const answers = new WeakMap<Page, Set<string>>();
const answered = (page: Page) => {
	const existing = answers.get(page);
	if (existing !== undefined) {
		return existing;
	}
	const created = new Set<string>();
	answers.set(page, created);
	return created;
};

const answerSources = (page: Page, sources: readonly Record<string, unknown>[]) =>
	Effect.promise(() =>
		waitFor(() => {
			const pending = page
				.queryRequests("calendarSources")
				.filter(({ requestId }) => !answered(page).has(requestId));
			expect(pending.length).toBeGreaterThan(0);
			for (const request of pending) {
				answered(page).add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: { data: { calendarSources: rows(sources) } },
				});
			}
		}),
	);

const occurrenceRequests = (page: Page, alias: string) =>
	page
		.queryRequests("calendarOccurrences")
		.filter((request) => request.document.queries["calendarOccurrences"]?.from.alias === alias);

const nextOccurrenceRequest = (page: Page, alias: string) =>
	Effect.promise(() =>
		waitFor(() => {
			const request = occurrenceRequests(page, alias).find(
				({ requestId }) => !answered(page).has(requestId),
			);
			expect(request).toBeDefined();
			if (request === undefined) {
				throw new Error(`No pending ${alias} request`);
			}
			answered(page).add(request.requestId);
			return request;
		}),
	);

const answerOccurrences = (
	page: Page,
	alias: string,
	items: readonly Readonly<Record<string, unknown>>[],
	nextCursor: null | string = null,
) =>
	Effect.gen(function* () {
		const request = yield* nextOccurrenceRequest(page, alias);
		page.replyQuery(request.requestId, {
			outcome: "success",
			response: { data: { calendarOccurrences: rows(items, nextCursor) } },
		});
		return request;
	});

const daySection = (day: string) =>
	Effect.promise(() =>
		waitFor(() => {
			const section = document.querySelector<HTMLElement>(`section[data-day="${day}"]`);
			expect(section).not.toBeNull();
			if (section === null) {
				throw new Error(`Missing ${day}`);
			}
			return section;
		}),
	);

const rowTexts = (section: HTMLElement) =>
	within(section)
		.getAllByRole("link")
		.map((link) => link.textContent);

const pageSearches = (page: Page) =>
	page.clientMessages().flatMap((message) => (message.type === "page-search" ? [message] : []));

const useTimeZone = (timeZone: string) => {
	let previous: string | undefined;
	beforeEach(() => {
		previous = process.env["TZ"];
		process.env["TZ"] = timeZone;
	});
	afterEach(() => {
		if (previous === undefined) {
			delete process.env["TZ"];
		} else {
			process.env["TZ"] = previous;
		}
	});
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const localMonthStart = (year: number, index: number) => new Date(year, index, 1).toISOString();

const dayLabel = (day: string) => {
	const [year = 1970, index = 1, date = 1] = day.split("-").map(Number);
	return new Intl.DateTimeFormat(undefined, {
		month: "long",
		day: "numeric",
		weekday: "long",
	}).format(new Date(year, index - 1, date));
};

const firstWeekday = () =>
	new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 1));

const march14 = Date.UTC(2026, 2, 14, 12);

describe("calendar renderer", () => {
	useTimeZone("UTC");

	it.live("shares the month window across layout changes while paging a source", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, search: "month=2026-03" });
			yield* answerSources(page, [source("tasks")]);
			const first = yield* nextOccurrenceRequest(page, "tasks");
			page.navigate(routeLocation("/v/k/calendar", "month=2026-03&layout=month&panel=details"));
			yield* Effect.promise(() => screen.findByRole("grid"));
			yield* waitForMessagePortMacrotask;
			expect(occurrenceRequests(page, "tasks")).toHaveLength(1);
			page.replyQuery(first.requestId, {
				outcome: "success",
				response: {
					data: {
						calendarOccurrences: rows(
							[occurrence("Alpha", "2026-03-14T00:00:00.000Z", "First")],
							"cursor-1",
						),
					},
				},
			});
			const second = yield* answerOccurrences(page, "tasks", [
				occurrence("Beta", "2026-03-14T00:00:00.000Z", "Second"),
			]);
			const document = encodeJson(second.document);
			expect(document).toContain("cursor-1");
			expect(document).toContain("2026-03-01T00:00:00.000Z");
			expect(document).toContain("2026-04-01T00:00:00.000Z");

			page.navigate(routeLocation("/v/k/calendar", "month=2026-03"));
			const day = yield* daySection("2026-03-14");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(rowTexts(day)).toEqual([
						expect.stringContaining("AlphaFirst"),
						expect.stringContaining("BetaSecond"),
					]),
				),
			);
			yield* waitForMessagePortMacrotask;
			expect(occurrenceRequests(page, "tasks")).toHaveLength(2);
			expect(page.queryRequests("calendarSources")).toHaveLength(1);
		}),
	);

	it.live("groups a month by day with date-only items first, dimmed past days and fallbacks", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14 });
			yield* answerSources(page, [
				source("tasks"),
				source("reminders", { art: null, done: null, precision: "instant" }),
			]);
			yield* answerOccurrences(page, "tasks", [
				occurrence("Alpha", "2026-03-10T00:00:00.000Z", "Step 1", {
					done: true,
					art: { type: "remote", url: "https://images.example/alpha.webp" },
				}),
				occurrence("Alpha", "2026-03-14T00:00:00.000Z", "Step 2", {
					art: { type: "local", url: "malformed" },
				}),
			]);
			yield* answerOccurrences(page, "reminders", [
				occurrence("Beta", "2026-03-14T15:30:00.000Z", "Note 3"),
				occurrence("Beta", "2026-03-14T09:00:00.000Z", "Note 2"),
			]);

			const past = yield* daySection("2026-03-10");
			const today = yield* daySection("2026-03-14");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(rowTexts(today)).toEqual([
						expect.stringContaining("AlphaStep 2"),
						expect.stringContaining("BetaNote 2"),
						expect.stringContaining("BetaNote 3"),
					]),
				),
			);
			expect(
				within(today)
					.getAllByTestId("calendar-time")
					.map((time) => time.textContent),
			).toEqual(["", "09:00", "15:30"]);
			expect(within(today).getByText("Today")).toBeTruthy();
			expect(within(today).getAllByTestId("calendar-icon-tile")).toHaveLength(3);
			expect(within(today).queryByRole("img", { name: "Done" })).toBeNull();

			const [pastRow] = within(past).getAllByRole("link");
			expect(pastRow?.hasAttribute("data-past")).toBe(true);
			expect(within(today).getAllByRole("link")[0]?.hasAttribute("data-past")).toBe(false);
			expect(within(past).getByRole("img", { name: "Done" })).toBeTruthy();
			expect(within(past).queryByTestId("calendar-icon-tile")).toBeNull();
			expect(past.querySelector("img")?.getAttribute("src")).toBe(
				"https://images.example/alpha.webp",
			);
			expect(pastRow?.getAttribute("href")).toContain("id-Alpha");
		}),
	);

	it.live("sends the chip toggle through the bridge and refreshes from the mutation hint", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14 });
			yield* answerSources(page, [source("tasks"), source("reminders")]);
			yield* answerOccurrences(page, "tasks", [
				occurrence("Alpha", "2026-03-20T00:00:00.000Z", "Step 3"),
			]);
			yield* answerOccurrences(page, "reminders", [
				occurrence("Beta", "2026-03-21T00:00:00.000Z", "Note 4"),
			]);
			yield* daySection("2026-03-21");
			const chip = screen.getByRole("button", { name: /reminders source/ });
			expect(chip.getAttribute("aria-pressed")).toBe("true");
			fireEvent.click(chip);
			const [request] = yield* Effect.promise(() =>
				waitFor(() => {
					const requests = page.calendarSourceVisibilityRequests();
					expect(requests).toHaveLength(1);
					return requests;
				}),
			);
			expect(request).toMatchObject({ isHidden: true, slug: "reminders", pluginId: "plugin-1" });
			page.replyCalendarSourceVisibility(request?.requestId ?? "", { outcome: "success" });
			yield* waitForMessagePortMacrotask;
			expect(page.queryRequests("calendarSources")).toHaveLength(1);
			const clock = pageClocks.get(page);
			expect(clock).toBeDefined();
			yield* Effect.promise(() => clock?.advance(250) ?? Promise.resolve());
			yield* answerSources(page, [source("tasks"), source("reminders", { isHidden: true })]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("button", { name: /reminders source/ }).getAttribute("aria-pressed"),
					).toBe("false"),
				),
			);
			expect(document.querySelector('section[data-day="2026-03-21"]')).toBeNull();
			expect(screen.getByText(/1 source hidden/)).toBeTruthy();
		}),
	);

	it.live("navigates months through the URL and reads the month from it", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, search: "month=2026-01" });
			yield* answerSources(page, [source("tasks")]);
			const january = yield* answerOccurrences(page, "tasks", []);
			expect(encodeJson(january.document)).toContain("2026-01-01T00:00:00.000Z");
			yield* Effect.promise(() => waitFor(() => screen.getByText("January 2026")));

			fireEvent.click(screen.getByRole("button", { name: "Next month" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearches(page).at(-1)?.update).toEqual({ layout: null, month: "2026-02" }),
				),
			);
			const february = yield* answerOccurrences(page, "tasks", []);
			expect(encodeJson(february.document)).toContain("2026-03-01T00:00:00.000Z");
			yield* Effect.promise(() => waitFor(() => screen.getByText("February 2026")));

			fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearches(page).at(-1)?.update).toEqual({ layout: null, month: "2026-01" }),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Today" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearches(page).at(-1)?.update).toEqual({ layout: null, month: "2026-03" }),
				),
			);
		}),
	);

	it.live("caps month cells at three items and opens the agenda at a day with more", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, search: "layout=month" });
			yield* answerSources(page, [source("tasks")]);
			yield* answerOccurrences(
				page,
				"tasks",
				["Part 1", "Part 2", "Part 3", "Part 4", "Part 5"].map((caption) =>
					occurrence("Zeta", "2026-03-25T00:00:00.000Z", caption),
				),
			);
			const cell = yield* Effect.promise(() =>
				waitFor(() => {
					const found = document.querySelector<HTMLElement>(
						'[role="gridcell"][data-day="2026-03-25"]',
					);
					expect(found).not.toBeNull();
					if (found === null) {
						throw new Error("Missing cell");
					}
					expect(within(found).getAllByRole("link")).toHaveLength(3);
					return found;
				}),
			);
			expect(screen.getAllByRole("columnheader")[0]?.textContent).toBe(firstWeekday());
			fireEvent.click(within(cell).getByRole("button", { name: "+2 more" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearches(page).at(-1)?.update).toEqual({ layout: null, month: "2026-03" }),
				),
			);
			const section = yield* daySection("2026-03-25");
			expect(within(section).getAllByRole("link")).toHaveLength(5);
			yield* Effect.promise(() =>
				waitFor(() => expect(section.contains(document.activeElement)).toBe(true)),
			);
		}),
	);

	it.live("fits the compact month to the viewport with dot cells that open the agenda", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, compact: true, search: "layout=month" });
			yield* answerSources(page, [source("tasks"), source("reminders")]);
			yield* answerOccurrences(
				page,
				"tasks",
				["Part 1", "Part 2", "Part 3", "Part 4"].map((caption) =>
					occurrence("Zeta", "2026-03-25T00:00:00.000Z", caption),
				),
			);
			yield* answerOccurrences(page, "reminders", [
				occurrence("Beta", "2026-03-25T10:00:00.000Z", "Note 1"),
			]);
			const grid = yield* Effect.promise(() => waitFor(() => screen.getByRole("grid")));
			expect(grid.className).not.toContain("min-w-[760px]");
			expect(grid.parentElement?.className).not.toContain("overflow-x-auto");
			const weeks = within(grid).getAllByRole("row").slice(1);
			expect(weeks).toHaveLength(6);
			for (const week of weeks) {
				expect(within(week).getAllByRole("gridcell")).toHaveLength(7);
			}
			const cell = yield* Effect.promise(() =>
				waitFor(() => {
					const found = document.querySelector<HTMLElement>(
						'[role="gridcell"][data-day="2026-03-25"]',
					);
					expect(found?.textContent).toContain("+2");
					if (found === null) {
						throw new Error("Missing cell");
					}
					return found;
				}),
			);
			expect(within(cell).queryAllByRole("link")).toHaveLength(0);
			expect(cell.textContent).not.toContain("Zeta");
			const button = within(cell).getByRole("button", { name: /, 5 items$/ });
			expect(button.getAttribute("aria-label")).toBe(`${dayLabel("2026-03-25")}, 5 items`);
			expect(button.className).toContain("min-h-14");
			expect(button.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(3);
			fireEvent.click(button);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(pageSearches(page).at(-1)?.update).toEqual({ layout: null, month: "2026-03" }),
				),
			);
			const section = yield* daySection("2026-03-25");
			expect(within(section).getAllByRole("link")).toHaveLength(5);
			yield* Effect.promise(() =>
				waitFor(() => expect(section.contains(document.activeElement)).toBe(true)),
			);
		}),
	);

	it.live("shows the empty state for a month without occurrences and for no sources", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14 });
			yield* answerSources(page, [source("tasks")]);
			yield* answerOccurrences(page, "tasks", []);
			yield* Effect.promise(() =>
				waitFor(() => screen.getByText("Nothing in March 2026 from the sources you show.")),
			);
			page.dispose();
			const empty = yield* open({ now: march14 });
			yield* answerSources(empty, []);
			yield* Effect.promise(() =>
				waitFor(() => screen.getByText("No installed plugin adds calendar sources yet.")),
			);
		}),
	);

	it.live("reports one failing source while the others still render", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14 });
			yield* answerSources(page, [source("tasks"), source("reminders")]);
			const failing = yield* nextOccurrenceRequest(page, "reminders");
			page.replyQuery(failing.requestId, { outcome: "failure", reason: "query-failed" });
			yield* answerOccurrences(page, "tasks", [
				occurrence("Alpha", "2026-03-20T00:00:00.000Z", "Step 3"),
			]);
			yield* daySection("2026-03-20");
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("alert").textContent).toContain(
						"reminders source could not be loaded.",
					),
				),
			);
		}),
	);

	it.live("stops paging a source at its occurrence cap and says so", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, search: "layout=month" });
			yield* answerSources(page, [source("tasks")]);
			const pages = MAX_SOURCE_OCCURRENCES / 100;
			for (let index = 0; index < pages; index += 1) {
				const request = yield* answerOccurrences(
					page,
					"tasks",
					Array.from({ length: 100 }, (_, item) =>
						occurrence(`Record ${index}-${item}`, "2026-03-20T00:00:00.000Z", null),
					),
					`cursor-${index + 1}`,
				);
				const output = request.document.queries["calendarOccurrences"]?.output;
				expect(output?.type === "rows" ? output.pagination : undefined).toEqual(
					index === 0 ? { limit: 100 } : { limit: 100, after: `cursor-${index}` },
				);
			}
			yield* Effect.promise(() =>
				waitFor(() =>
					screen.getByText(
						`Showing the first ${MAX_SOURCE_OCCURRENCES.toLocaleString()} items from tasks source.`,
					),
				),
			);
			expect(occurrenceRequests(page, "tasks")).toHaveLength(pages);
			expect(
				screen.getByRole("button", { name: `+${MAX_SOURCE_OCCURRENCES - 3} more` }),
			).toBeDefined();
		}),
	);

	it.live("moves sources into a compact sheet whose switches send visibility changes", () =>
		Effect.gen(function* () {
			const page = yield* open({ now: march14, compact: true });
			yield* answerSources(page, [source("tasks"), source("reminders", { isHidden: true })]);
			yield* answerOccurrences(page, "tasks", []);
			expect(screen.queryByRole("region", { name: "Sources" })).toBeNull();
			fireEvent.click(
				yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("button", { name: "Sources, 1 hidden" })),
				),
			);
			const sheet = yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("dialog", { name: "Sources" })),
			);
			const hidden = within(sheet).getByRole("switch", { name: "Show reminders source" });
			expect(hidden.getAttribute("aria-checked")).toBe("false");
			fireEvent.click(hidden);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(page.calendarSourceVisibilityRequests()).toMatchObject([
						{ isHidden: false, slug: "reminders" },
					]),
				),
			);
		}),
	);

	for (const [timeZone, midnight, beforeMidnight] of [
		["Etc/GMT+5", "2026-01-15T05:00:00.000Z", "2026-01-15T04:59:00.000Z"],
		["Etc/GMT-9", "2026-01-14T15:00:00.000Z", "2026-01-14T14:59:00.000Z"],
	] as const) {
		describe(timeZone, () => {
			useTimeZone(timeZone);
			it.live(`keeps date-only items on their days and instants on local days in ${timeZone}`, () =>
				Effect.gen(function* () {
					const page = yield* open({ now: Date.UTC(2026, 0, 20, 12) });
					yield* answerSources(page, [
						source("deadlines"),
						source("reminders", { precision: "instant" }),
					]);
					const deadlines = yield* answerOccurrences(page, "deadlines", [
						occurrence("Gamma", "2026-01-01T00:00:00.000Z", "Due"),
						occurrence("Delta", "2026-01-31T00:00:00.000Z", "Due"),
					]);
					const reminders = yield* answerOccurrences(page, "reminders", [
						occurrence("Epsilon", midnight, "Note 11"),
						occurrence("Epsilon", beforeMidnight, "Note 10"),
					]);
					expect(encodeJson(deadlines.document)).toContain("2026-01-01T00:00:00.000Z");
					expect(encodeJson(deadlines.document)).toContain("2026-02-01T00:00:00.000Z");
					expect(encodeJson(reminders.document)).toContain(localMonthStart(2026, 0));
					expect(rowTexts(yield* daySection("2026-01-01"))).toEqual([
						expect.stringContaining("Gamma"),
					]);
					expect(rowTexts(yield* daySection("2026-01-31"))).toEqual([
						expect.stringContaining("Delta"),
					]);
					expect(rowTexts(yield* daySection("2026-01-15"))).toEqual([
						expect.stringContaining("Note 11"),
					]);
					const previous = yield* daySection("2026-01-14");
					expect(rowTexts(previous)).toEqual([expect.stringContaining("Note 10")]);
					expect(within(previous).getByTestId("calendar-time").textContent).toBe("23:59");
				}),
			);
		});
	}
});
