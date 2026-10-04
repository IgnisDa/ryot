import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { encodeFilterParam } from "@ryot-app/ryotql-recipes/filters";
import { fireEvent, waitFor, within } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { preferenceSettings } from "../../tests/client/draft-fixtures";
import WorkoutsPage from "./screen";

const serialize = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

afterEach(disposePluginBridges);

const HOUR_MS = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS).toISOString();

const rows = (items: readonly Record<string, unknown>[], nextCursor: string | null = null) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
});
const aggregate = (items: readonly Record<string, number>[]) => ({
	items,
	type: "aggregate" as const,
});
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

const listWorkout = (id: string, name: string, startedAt: string) => ({
	id,
	name,
	startedAt,
	setCount: 2,
	volume: 1000,
	exerciseCount: 2,
	personalBests: 1,
	template: rows([]),
	endedAt: startedAt,
	activeDuration: 3600,
	repeatedFromId: "prior",
	previousTemplateWorkoutId: null,
	sets: rows([listSet("squat", "Back Squat", 0), listSet("press", "Leg Press", 1)]),
});

type Answers = {
	readonly total?: number;
	readonly list?: (after: string | undefined) => ReturnType<typeof rows>;
};

type Queries = ReturnType<
	ReturnType<typeof mountPluginPage>["queryRequests"]
>[number]["document"]["queries"];

const respond = (queries: Queries, answers: Answers) => {
	const list = queries["workouts"];
	if (list?.output.type === "rows" && list.output.include !== undefined) {
		return {
			workouts:
				answers.list?.(list.output.pagination.after) ??
				rows([listWorkout("w1", "Legs", hoursAgo(1))]),
		};
	}
	if (list?.output.type === "rows") {
		return { workouts: rows([{ id: "prior", volume: 800, startedAt: hoursAgo(24 * 7) }]) };
	}
	if ("exercises" in queries) {
		return {
			exercises: rows([
				{ id: "squat", targets: rows([{ role: "primary", name: "Quadriceps" }]) },
				{ id: "press", targets: rows([{ name: "Glutes", role: "secondary" }]) },
			]),
		};
	}
	if ("total" in queries) {
		return { total: aggregate([{ workouts: answers.total ?? 0 }]) };
	}
	return Object.fromEntries(
		Object.keys(queries).map((key) => {
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
const settle = (assert: () => void) =>
	Effect.promise(() =>
		waitFor(() => {
			answerCurrent();
			assert();
		}),
	);
let answerCurrent = () => {};

describe("all workouts page", () => {
	it.live("groups workouts into weeks with a summary, muscles, best sets and comparisons", () =>
		Effect.gen(function* () {
			answerCurrent = openPage().answerPending;
			yield* settle(() => {
				const card = body.getByRole("article", { name: "Legs" });
				expect(card.textContent).toContain("Repeated from");
				expect(card.textContent).toContain("▲ 25% volume");
				expect(card.textContent).toContain("100 kg × 5");
				expect(within(card).getByRole("list", { name: "Muscles" }).textContent).toBe(
					"GlutesQuadriceps",
				);
				expect(body.getByRole("region", { name: "Summary" }).textContent).toContain("Workouts");
			});
		}),
	);

	it.live("counts every workout on request and loads earlier pages with the next cursor", () =>
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
			fireEvent.click(body.getByRole("button", { name: "Show earlier weeks" }));
			yield* settle(() => {
				expect(body.getByRole("link", { name: "Pull" })).toBeTruthy();
				expect(body.queryByRole("button", { name: "Show earlier weeks" })).toBeNull();
			});
			expect(cursors).toEqual([undefined, "older"]);
		}),
	);

	it.live("stores the chosen layout and the normalized search in the page search", () =>
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
				).toEqual([{ layout: "table" }, { search: "leg day" }]),
			);
		}),
	);

	it.live("shows the table layout and expands list rows into every exercise", () =>
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
	);

	it.live("invites the first workout when there are none", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage({ list: () => rows([]) });
			answerCurrent = answerPending;
			yield* settle(() => expect(body.getByText("No workouts yet")).toBeTruthy());
			fireEvent.click(body.getByRole("button", { name: "Start workout" }));
			yield* settle(() =>
				expect(page.clientMessages().some(({ type }) => type === "navigate")).toBe(true),
			);
		}),
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
						"Exercises",
					);
					expect(body.getByRole("link", { name: "Legs" })).toBeTruthy();
				});
				const queried = (name: string) =>
					page
						.queryRequests()
						.filter(({ document }) => name in document.queries)
						.map(({ document }) => serialize(document.queries[name]).includes("filterTotalsSet"));
				expect(queried("workouts").some(Boolean)).toBe(true);
				expect(queried("sets").every(Boolean)).toBe(true);
			}),
	);

	it.live("offers to clear the filters when none match", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openPage({ list: () => rows([]) }, exerciseFilter);
			answerCurrent = answerPending;
			yield* settle(() => expect(body.getByText("No matching workouts")).toBeTruthy());
			expect(body.queryByText("No workouts yet")).toBeNull();
			fireEvent.click(body.getByRole("button", { name: "Clear filters" }));
			yield* settle(() =>
				expect(
					page
						.clientMessages()
						.flatMap((message) => (message.type === "page-search" ? [message.update] : [])),
				).toEqual([{ filters: null }]),
			);
		}),
	);
});
