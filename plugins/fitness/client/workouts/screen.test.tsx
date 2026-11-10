import { afterEach, describe, expect } from "bun:test";

import type {
	AggregateResult,
	RowsResult,
	RyotQLResult,
} from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { encodeFilterParam } from "@ryot-app/ryotql-recipes/filters";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, waitFor, within } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { preferenceSettings } from "../../tests/client/draft-fixtures";
import WorkoutsPage from "./screen";

const serialize = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

afterEach(disposePluginBridges);

const HOUR_MS = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS).toISOString();

const rows = (items: RowsResult["items"], nextCursor: null | string = null): RowsResult => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const aggregate = (items: readonly Record<string, number>[]): AggregateResult => ({
	items,
	type: "aggregate" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const processingPoll = (queries: Record<string, unknown>) =>
	Object.keys(queries).join() === "processing";
const totals = { workouts: 1, timedWorkouts: 1, activeDuration: 3600 };

const listSet = (exerciseId: string, exerciseName: string, exerciseOrder: number) => ({
	reps: 5,
	exerciseId,
	oneRm: null,
	weight: 100,
	setOrder: 0,
	exerciseName,
	exerciseOrder,
	duration: null,
	distance: null,
	personalBests: null,
	id: `${exerciseId}-set`,
	exerciseKind: "reps_and_weight",
});

const listWorkout = (entityId: string, name: string, startedAt: string) => ({
	name,
	entityId,
	startedAt,
	setCount: 2,
	volume: 1000,
	exerciseCount: 2,
	personalBests: 1,
	template: rows([]),
	endedAt: startedAt,
	processing: "ready",
	activeDuration: 3600,
	repeatedFromId: "prior",
	previousTemplateWorkoutId: null,
	sets: rows([listSet("squat", "Back Squat", 0), listSet("press", "Leg Press", 1)]),
});

type Queries = ReturnType<
	ReturnType<typeof mountPluginPage>["queryRequests"]
>[number]["document"]["queries"];

type Answers = {
	readonly total?: number;
	readonly deferProcessing?: boolean;
	readonly processingPending?: boolean;
	readonly projectionPending?: boolean;
	readonly ids?: (after: string | undefined) => ReturnType<typeof rows>;
	readonly list?: (after: string | undefined) => ReturnType<typeof rows>;
};

const respond = (queries: Queries, answers: Answers) => {
	if (processingPoll(queries)) {
		return { processing: aggregate([{ failed: 0, pending: answers.processingPending ? 1 : 0 }]) };
	}
	const ids = queries["workoutIds"];
	if (ids?.output.type === "rows") {
		return { workoutIds: answers.ids?.(ids.output.pagination.after) ?? rows([{ entityId: "w1" }]) };
	}
	const list = queries["workouts"];
	if (list?.output.type === "rows" && list.output.include !== undefined) {
		return {
			workouts:
				answers.list?.(list.output.pagination.after) ??
				rows([
					{
						...listWorkout("w1", "Legs", hoursAgo(1)),
						processing: answers.projectionPending ? "pending" : "ready",
					},
				]),
		};
	}
	if (list?.output.type === "rows") {
		return { workouts: rows([{ id: "prior", volume: 800, startedAt: hoursAgo(24 * 7) }]) };
	}
	if ("taxonomy" in queries) {
		return {
			taxonomy: rows([
				{
					setCount: 1,
					workoutId: "w1",
					exerciseOrder: 0,
					id: "occurrence-0",
					exerciseId: "squat",
					equipment: rows([]),
					targets: rows([{ role: "primary", id: "quadriceps", name: "Quadriceps" }]),
				},
				{
					setCount: 1,
					workoutId: "w1",
					exerciseOrder: 1,
					id: "occurrence-1",
					exerciseId: "press",
					equipment: rows([]),
					targets: rows([{ id: "glutes", name: "Glutes", role: "secondary" }]),
				},
			]),
		};
	}
	if ("total" in queries) {
		return { total: aggregate([{ workouts: answers.total ?? 0 }]) };
	}
	return Object.fromEntries(
		Object.keys(queries).map((key): [string, RyotQLResult] => {
			if (key === "processing") {
				return [key, aggregate([{ failed: 0, pending: answers.projectionPending ? 1 : 0 }])];
			}
			if (key === "latestRecord") {
				return [key, rows([])];
			}
			if (key === "workouts" || key === "dayWorkouts") {
				return [key, aggregate([])];
			}
			if (key === "sets" || key === "daySets") {
				return [key, aggregate([])];
			}
			return [key, aggregate([key.endsWith("Sets") ? { volume: 1000, personalBests: 1 } : totals])];
		}),
	);
};

const openPage = (answers: Answers = {}, search = "") => {
	const page = mountPluginPage(WorkoutsPage, {
		location: routeLocation("/v/all-workouts", search),
		userPreferences: { ratingScale: "hundred", timeZone: TimeZone.make("UTC") },
		page: {
			...savedViewPageContext({
				settings: {},
				rendererName: "workouts",
				savedViewId: "all-workouts",
				dataSources: { queries: {} },
				view: { icon: "dumbbell", name: "All Workouts" },
			}),
			contributors: [
				pluginContributor({
					name: "fitness",
					pluginId: "fitness-owner",
					packageId: PLUGIN_PACKAGE_ID,
				}),
			],
		},
	});
	const answered = new Set<string>();
	const answerPending = () => {
		for (const request of page.clientMessages()) {
			if (request.type === "operation-request" && !answered.has(request.requestId)) {
				answered.add(request.requestId);
				page.send({
					outcome: "success",
					type: "operation-result",
					requestId: request.requestId,
					value: { proAvailable: false, settings: preferenceSettings },
				});
			}
		}
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				if (answers.deferProcessing && processingPoll(request.document.queries)) {
					continue;
				}
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: { data: respond(request.document.queries, answers) },
				});
			}
		}
	};
	return { page, answerPending };
};

const exerciseFilter = `?filters=${encodeFilterParam({
	value: 3,
	operator: "gte",
	field: "exerciseCount",
})}`;

const body = within(document.body);
const settle = (check: () => void) =>
	Effect.promise(() =>
		waitFor(() => {
			answerCurrent();
			check();
		}),
	);
let answerCurrent = () => {};

const changeMembersRequest = (page: ReturnType<typeof openPage>["page"]) =>
	Effect.promise(() =>
		waitFor(() => {
			answerCurrent();
			const found = page
				.clientMessages()
				.findLast(({ type }) => type === "change-collection-members-screen");
			assert(found?.type === "change-collection-members-screen");
			return found;
		}),
	);

describe("all workouts page", () => {
	it.live(
		"shows workout values while that workout's projections are pending",
		() =>
			Effect.gen(function* () {
				answerCurrent = openPage({ projectionPending: true }).answerPending;
				yield* settle(() => {
					const card = body.getByRole("article", { name: "Legs" });
					expect(card.textContent).toContain("100 kg × 5");
					expect(card.textContent).toContain("1,000 kg");
					expect(card.textContent).toContain("1 PR");
				});
			}),
		testTimeout,
	);
	it.live(
		"shows one processing note and keeps values while workout processing is pending",
		() =>
			Effect.gen(function* () {
				answerCurrent = openPage({ processingPending: true }).answerPending;
				const note = "Updating calculated results. Values shown may change.";
				yield* settle(() => {
					const card = body.getByRole("article", { name: "Legs" });
					expect(card.textContent).not.toContain(note);
					expect(card.textContent).toContain("1 PR");
					expect(card.textContent).toContain("1,000 kg");
					expect(body.getAllByText(note)).toHaveLength(1);
				});
				for (const label of ["List view", "Table view"]) {
					fireEvent.click(body.getByRole("radio", { name: label }));
					yield* settle(() => {
						expect(body.getAllByText(note)).toHaveLength(1);
						expect(body.getAllByText(/1,000 kg/).length).toBeGreaterThan(0);
					});
				}
			}),
		testTimeout,
	);

	it.live(
		"shows values without a note while the processing check is unanswered",
		() =>
			Effect.gen(function* () {
				const answers = { deferProcessing: true };
				answerCurrent = openPage(answers).answerPending;
				yield* settle(() => {
					const card = body.getByRole("article", { name: "Legs" });
					expect(card.textContent).toContain("1,000 kg");
					expect(card.textContent).toContain("1 PR");
					expect(body.queryByText(/calculated results/)).toBeNull();
				});
			}),
		testTimeout,
	);

	it.live(
		"groups workouts into weeks with a summary, muscles, best sets and comparisons",
		() =>
			Effect.gen(function* () {
				answerCurrent = openPage().answerPending;
				yield* settle(() => {
					const card = body.getByRole("article", { name: "Legs" });
					expect(card.textContent).toContain("Repeated from");
					expect(card.textContent).toContain("▲ 25% volume");
					expect(card.textContent).toContain("100 kg × 5");
					expect(within(card).getByRole("list", { name: "Muscles" }).textContent).toBe(
						"QuadricepsGlutes",
					);
					expect(body.getByRole("region", { name: "Summary" }).textContent).toContain("Workouts");
				});
			}),
		testTimeout,
	);

	it.live(
		"counts every workout on request and loads earlier pages with the next cursor",
		() =>
			Effect.gen(function* () {
				const cursors: Array<string | undefined> = [];
				answerCurrent = openPage({
					total: 42,
					list: (after) => {
						cursors.push(after);
						return after === undefined
							? rows([listWorkout("w1", "Legs", hoursAgo(1))], "older")
							: rows([listWorkout("w2", "Pull", hoursAgo(24 * 21))]);
					},
				}).answerPending;
				yield* settle(() => expect(body.getByRole("button", { name: "Count all" })).toBeTruthy());
				fireEvent.click(body.getByRole("button", { name: "Count all" }));
				yield* settle(() => expect(body.getByText("1 of 42 workouts")).toBeTruthy());
				fireEvent.click(body.getByRole("button", { name: "Load more results" }));
				yield* settle(() => {
					expect(body.getByRole("link", { name: "Pull" })).toBeTruthy();
					expect(body.queryByRole("button", { name: "Load more results" })).toBeNull();
				});
				expect(cursors).toEqual([undefined, "older"]);
			}),
		testTimeout,
	);

	it.live(
		"stores the chosen layout and the normalized search in the page search",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage();
				answerCurrent = answerPending;
				yield* settle(() => expect(body.getByRole("link", { name: "Legs" })).toBeTruthy());
				fireEvent.click(body.getByRole("radio", { name: "Table view" }));
				fireEvent.change(body.getByRole("searchbox", { name: "Search All Workouts" }), {
					target: { value: "  leg   day " },
				});
				yield* settle(() =>
					expect(
						page
							.clientMessages()
							.flatMap((message) => (message.type === "page-search" ? [message.update] : [])),
					).toEqual([{ layout: "table" }, { sort: null, filters: null, search: "leg day" }]),
				);
			}),
		testTimeout,
	);

	it.live(
		"shows the table layout and expands list rows into every exercise",
		() =>
			Effect.gen(function* () {
				answerCurrent = openPage({}, "?layout=table").answerPending;
				yield* settle(() =>
					expect(body.getAllByRole("columnheader").map(({ textContent }) => textContent)).toEqual([
						"Date",
						"Workout",
						"Muscles",
						"Duration",
						"Exercises",
						"Sets",
						"Volume",
						"PRs",
					]),
				);
				disposePluginBridges();
				answerCurrent = openPage({}, "?layout=list").answerPending;
				yield* settle(() => expect(body.getByRole("button", { name: "Expand Legs" })).toBeTruthy());
				fireEvent.click(body.getByRole("button", { name: "Expand Legs" }));
				yield* settle(() =>
					expect(body.getAllByRole("row").map(({ textContent }) => textContent)).toEqual([
						"ExerciseSetsBest set",
						"Back Squat1100 kg × 5",
						"Leg Press1100 kg × 5",
					]),
				);
			}),
		testTimeout,
	);

	it.live(
		"invites the first workout when there are none",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage({ list: () => rows([]) });
				answerCurrent = answerPending;
				yield* settle(() => expect(body.getByText("All Workouts is empty")).toBeTruthy());
				const emptyState = body
					.getByRole("heading", { name: "All Workouts is empty" })
					.closest("section");
				assert(emptyState instanceof HTMLElement);
				fireEvent.click(within(emptyState).getByRole("button", { name: "Start workout" }));
				yield* settle(() =>
					expect(page.clientMessages().some(({ type }) => type === "navigate")).toBe(true),
				);
			}),
		testTimeout,
	);

	it.live(
		"shows the active filter count and chip and narrows the list, count and week queries",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage({ total: 4 }, exerciseFilter);
				answerCurrent = answerPending;
				yield* settle(() => {
					expect(body.getByRole("button", { name: "Filters, 1 active filter" })).toBeTruthy();
					expect(body.getByRole("group", { name: "Active filters" }).textContent).toContain(
						"Exercise count",
					);
					expect(body.getByRole("link", { name: "Legs" })).toBeTruthy();
				});
				const queried = (name: string) =>
					Effect.forEach(
						page.queryRequests().filter(({ document }) => name in document.queries),
						({ document }) =>
							Effect.map(serialize(document.queries[name]), (text) =>
								text.includes("filterTotalsSet"),
							),
					);
				expect((yield* queried("workouts")).some(Boolean)).toBe(true);
				expect((yield* queried("sets")).every(Boolean)).toBe(true);
			}),
		testTimeout,
	);

	it.live(
		"offers to clear the filters when none match",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage({ list: () => rows([]) }, exerciseFilter);
				answerCurrent = answerPending;
				yield* settle(() => expect(body.getByText("No matches in All Workouts")).toBeTruthy());
				expect(body.queryByText("All Workouts is empty")).toBeNull();
				fireEvent.click(body.getByRole("button", { name: "Clear filters" }));
				yield* settle(() =>
					expect(
						page
							.clientMessages()
							.flatMap((message) => (message.type === "page-search" ? [message.update] : [])),
					).toEqual([{ sort: null, search: null, filters: null }]),
				);
			}),
		testTimeout,
	);
	it.live(
		"adds selected workouts to a collection through the kernel members screen",
		() =>
			Effect.gen(function* () {
				const { page, answerPending } = openPage();
				answerCurrent = answerPending;
				yield* settle(() => expect(body.getByRole("button", { name: "Select" })).toBeTruthy());
				fireEvent.click(body.getByRole("button", { name: "Select" }));
				fireEvent.click(body.getByRole("checkbox", { name: "Select Legs" }));
				expect(body.getByRole("region", { name: "Selection" }).textContent).toContain("1 selected");
				fireEvent.click(body.getByRole("button", { name: "Add to collection" }));
				const change = yield* changeMembersRequest(page);
				expect(change).toMatchObject({ kind: "add", entityIds: ["w1"] });
				page.send({
					outcome: "success",
					value: { kind: "changed" },
					requestId: change.requestId,
					type: "change-collection-members-screen-result",
				});
				yield* settle(() => expect(body.queryByRole("region", { name: "Selection" })).toBeNull());
			}),
		testTimeout,
	);

	it.live(
		"resolves every matching workout except excluded ones through the ids query",
		() =>
			Effect.gen(function* () {
				const cursors: Array<string | undefined> = [];
				const { page, answerPending } = openPage({
					total: 3,
					list: (after) =>
						after === undefined
							? rows([listWorkout("w1", "Legs", hoursAgo(1))], "older")
							: rows([]),
					ids: (after) => {
						cursors.push(after);
						return after === undefined
							? rows([{ entityId: "w1" }, { entityId: "w2" }], "more")
							: rows([{ entityId: "w3" }]);
					},
				});
				answerCurrent = answerPending;
				yield* settle(() => expect(body.getByRole("button", { name: "Select" })).toBeTruthy());
				fireEvent.click(body.getByRole("button", { name: "Select" }));
				fireEvent.click(body.getByRole("button", { name: "Select all matching" }));
				yield* settle(() =>
					expect(body.getByRole("region", { name: "Selection" }).textContent).toContain(
						"3 selected",
					),
				);
				fireEvent.click(body.getByRole("checkbox", { name: "Select Legs" }));
				yield* settle(() =>
					expect(body.getByRole("region", { name: "Selection" }).textContent).toContain(
						"2 selected",
					),
				);
				fireEvent.click(body.getByRole("button", { name: "Add to collection" }));
				const change = yield* changeMembersRequest(page);
				expect(change).toMatchObject({ kind: "add", entityIds: ["w2", "w3"] });
				expect(cursors).toEqual([undefined, "more"]);
			}),
		testTimeout,
	);
});
