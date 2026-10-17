import { afterEach, describe, expect, it } from "@effect/vitest";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, waitFor, within } from "@testing-library/dom";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { preferenceSettings } from "../../tests/client/draft-fixtures";
import { storedEditorDraft } from "../../tests/client/exercise-fixtures";
import FitnessHomePage from "./screen";

afterEach(disposePluginBridges);

const pluginId = PluginId.make("fitness-owner");
const pageContext: ClientPageContext = {
	view: null,
	settings: {},
	dataSources: null,
	route: { params: {} },
	renderer: { pluginId, kind: "plugin", exportName: "fitness-home" },
	target: { path: "/", search: "", kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
	contributors: [pluginContributor({ pluginId, name: "Fitness", packageId: PLUGIN_PACKAGE_ID })],
};

const HOUR_MS = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS).toISOString();

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});
const aggregate = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "aggregate" as const,
});

const dayTotals = {
	volume: 0,
	workouts: 1,
	personalBests: 0,
	timedWorkouts: 1,
	activeDuration: 3600,
};

const latestWorkout = {
	id: "w1",
	setCount: 21,
	volume: 24600,
	name: "Legs - 2",
	exerciseCount: 7,
	personalBests: 1,
	template: rows([]),
	activeDuration: 5220,
	repeatedFromId: null,
	endedAt: hoursAgo(46),
	startedAt: hoursAgo(48),
	previousTemplateWorkoutId: null,
	sets: rows([
		{
			reps: 5,
			id: "s1",
			oneRm: null,
			setOrder: 0,
			weight: 100,
			duration: null,
			distance: null,
			exerciseOrder: 0,
			exerciseId: "squat",
			personalBests: null,
			exerciseName: "Back Squat",
			exerciseKind: "reps_and_weight",
		},
	]),
};

const pinnedMetric = {
	unit: "kg",
	id: "weight",
	key: "weight",
	rangeCount: 3,
	name: "Weight",
	latestValue: 73.6,
	latestAt: hoursAgo(24 * 11),
	firstAt: hoursAgo(24 * 100),
	pinnedAt: hoursAgo(24 * 90),
};

type Scenario = {
	readonly workouts: boolean;
	readonly goal?: number | null;
	readonly metrics?: readonly Record<string, unknown>[];
	readonly storedDraft?: string;
};

const respond = (
	queries: Record<string, { readonly output: { readonly type: string } }>,
	scenario: Scenario,
) => {
	const names = Object.keys(queries);
	if (names.includes("recentCount")) {
		return {
			recentCount: aggregate([{ count: 3 }]),
			recent: rows([
				{
					reps: 25,
					id: "pr1",
					weight: 30,
					duration: null,
					distance: null,
					exerciseId: "bench",
					personalBests: ["reps"],
					occurredAt: hoursAgo(72),
					exerciseKind: "reps_and_weight",
					exerciseName: "Dumbbell Bench Press",
				},
			]),
		};
	}
	if (names.includes("groups")) {
		return {
			targets: rows([{ name: "Chest" }, { name: "Neck" }]),
			groups: aggregate([{ sets: 4, name: "Chest", role: "primary", lastAt: hoursAgo(24 * 4) }]),
		};
	}
	if (names.includes("templates")) {
		return {
			templates: rows([
				{
					id: "t1",
					name: "Push",
					exerciseCount: 1,
					schemaSlug: "workout-template",
					exercises: [{ exerciseId: "bench" }],
					lastWorkout: rows([{ endedAt: null, activeDuration: 3600, startedAt: hoursAgo(24 * 4) }]),
				},
			]),
		};
	}
	if (names.includes("metrics")) {
		return { metrics: rows([...(scenario.metrics ?? [])]) };
	}
	if (names.includes("workouts") && queries["workouts"]?.output.type === "rows") {
		return { workouts: rows(scenario.workouts ? [latestWorkout] : []) };
	}
	if (names.includes("exercises")) {
		return {
			exercises: rows([
				{ id: "squat", targets: rows([{ role: "primary", name: "Quadriceps" }]) },
				{ id: "bench", targets: rows([{ name: "Chest", role: "primary" }]) },
			]),
		};
	}
	return Object.fromEntries(
		names.map((key) => {
			if (key === "latestRecord") {
				return [key, rows([])];
			}
			if (key === "daySets") {
				return [key, aggregate([])];
			}
			if (key === "dayWorkouts") {
				return [key, aggregate([{ ...dayTotals, at: new Date().toISOString() }])];
			}
			return [
				key,
				aggregate([
					key.endsWith("Sets") || key === "daySets" ? { volume: 0, personalBests: 0 } : dayTotals,
				]),
			];
		}),
	);
};

const openHome = (scenario: Scenario) => {
	const page = mountPluginPage(FitnessHomePage, {
		page: pageContext,
		location: routeLocation("/"),
	});
	const answered = new Set<string>();
	const answerPending = () => {
		for (const message of page.clientMessages()) {
			if (message.type === "operation-request" && !answered.has(message.requestId)) {
				answered.add(message.requestId);
				page.send({
					outcome: "success",
					type: "operation-result",
					requestId: message.requestId,
					value: {
						proAvailable: false,
						settings:
							scenario.goal === undefined
								? preferenceSettings
								: { ...preferenceSettings, weeklyWorkoutGoal: scenario.goal },
					},
				});
			}
			if (
				message.type === "storage-request" &&
				message.action === "get" &&
				!answered.has(message.requestId)
			) {
				answered.add(message.requestId);
				page.send({
					outcome: "success",
					type: "storage-result",
					requestId: message.requestId,
					value: scenario.storedDraft ?? null,
				});
			}
		}
		for (const request of page.queryRequests()) {
			if (!answered.has(request.requestId)) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: { data: respond(request.document.queries, scenario) },
				});
			}
		}
	};
	return { page, answerPending };
};

const body = within(document.body);
let answerCurrent = () => {};
const settle = (assert: () => void) =>
	Effect.promise(() =>
		waitFor(
			() => {
				answerCurrent();
				assert();
			},
			{ timeout: 10_000 },
		),
	);

describe("fitness home", () => {
	it.live("invites a new user to set up, with checklist progress from their data", () =>
		Effect.gen(function* () {
			answerCurrent = openHome({ goal: 4, workouts: false, metrics: [pinnedMetric] }).answerPending;
			yield* settle(() => {
				expect(body.getByRole("heading", { name: "Your training starts here" })).toBeTruthy();
				expect(body.getByText("2 of 4 done")).toBeTruthy();
			});
			expect(body.getByRole("link", { name: "Start your first workout" })).toBeTruthy();
			expect(body.getByRole("link", { name: "Upload CSV for Hevy export" })).toBeTruthy();
			expect(body.queryByRole("region", { name: "Weekly goal" })).toBeNull();
		}),
	);

	it.live("shows the launchpad with the week, last workout, templates, muscles and records", () =>
		Effect.gen(function* () {
			answerCurrent = openHome({ goal: 5, workouts: true, metrics: [pinnedMetric] }).answerPending;
			yield* settle(() => {
				expect(
					within(body.getByRole("region", { name: "Weekly goal" })).getByText("of 5 workouts"),
				).toBeTruthy();
				expect(
					within(body.getByRole("region", { name: "Last workout" })).getByText("Legs - 2"),
				).toBeTruthy();
				expect(body.getByRole("link", { name: "Start Push" }).getAttribute("href")).toContain(
					"/templates/t1/start",
				);
				expect(body.getByText("Never")).toBeTruthy();
				expect(body.getByText("4 sets")).toBeTruthy();
				expect(
					within(body.getByRole("region", { name: "Pinned measurements" })).getByText("73.6 kg"),
				).toBeTruthy();
				expect(body.getByText("Most reps · ", { exact: false })).toBeTruthy();
				expect(body.getByText("3 in the last 30 days")).toBeTruthy();
			});
			expect(body.queryByRole("heading", { name: "Your training starts here" })).toBeNull();
		}),
	);

	it.live("asks for a weekly goal once a goal is cleared and links to plugin preferences", () =>
		Effect.gen(function* () {
			answerCurrent = openHome({ goal: null, workouts: true }).answerPending;
			yield* settle(() =>
				expect(body.getByRole("link", { name: "Choose a goal" }).getAttribute("href")).toBe(
					"/settings/plugin-preferences",
				),
			);
		}),
	);

	it.live("offers Resume for a device draft and navigates to the editor", () =>
		Effect.gen(function* () {
			const { page, answerPending } = openHome({
				workouts: true,
				storedDraft: storedEditorDraft({ name: "Push", startedAt: hoursAgo(1) }),
			});
			answerCurrent = answerPending;
			yield* settle(() => {
				const banner = body.getByRole("region", { name: "Workout in progress" });
				expect(within(banner).getByText("Push")).toBeTruthy();
			});
			expect(body.queryByRole("button", { name: "Start empty workout" })).toBeNull();
			fireEvent.click(
				within(body.getByRole("region", { name: "Workout in progress" })).getByRole("button", {
					name: "Resume",
				}),
			);
			yield* settle(() =>
				expect(page.clientMessages().filter((message) => message.type === "navigate")).toHaveLength(
					1,
				),
			);
		}),
	);
});
