import { EntityId, EntitySchemaSlug } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import type { HomeTemplate, MuscleActivity } from "../../shared/home-recipes";
import type { WorkoutSummary } from "../../shared/workout-list-recipes";
import type { ActiveEditorDraft } from "../exercise/active-draft";
import {
	buildMuscleTiles,
	buildTemplateCards,
	buildWeekProgress,
	draftBanner,
	formatHomeDate,
	lastWorkoutPhrase,
} from "./model";

const now = new Date("2026-10-21T12:00:00.000Z");

const totals = { volume: 0, workouts: 0, personalBests: 0, timedWorkouts: 0, activeDuration: 0 };
const day = (at: string, workouts: number) => ({ ...totals, at, workouts });

const summary: WorkoutSummary = {
	current: totals,
	previous: totals,
	latestRecord: null,
	days: [
		day("2026-10-19T00:00:00.000Z", 1),
		day("2026-10-12T00:00:00.000Z", 3),
		day("2026-10-05T00:00:00.000Z", 5),
		day("2026-09-28T00:00:00.000Z", 2),
		day("2026-09-21T00:00:00.000Z", 3),
	],
};

const template = (overrides: Partial<HomeTemplate>): HomeTemplate => ({
	name: "Template",
	exerciseCount: 2,
	lastWorkout: null,
	id: EntityId.make("t"),
	exerciseIds: ["squat", "press"],
	schemaSlug: EntitySchemaSlug.make("workout-template"),
	...overrides,
});

const draft = (mode: ActiveEditorDraft["mode"]): ActiveEditorDraft => ({
	mode,
	name: "Push",
	totalSets: 28,
	exerciseIds: [],
	confirmedSets: 12,
	startedAt: "2026-10-21T11:26:00.000Z",
});

describe("buildWeekProgress", () => {
	const week = buildWeekProgress({ now, summary, goal: 3, timeZone: "UTC" });

	it("marks trained days and labels today within the current local week", () => {
		expect(week.days.map(({ label }) => label)).toEqual([
			"Mon",
			"Tue",
			"Today",
			"Thu",
			"Fri",
			"Sat",
			"Sun",
		]);
		expect(week.days.map(({ trained }) => trained)).toEqual([
			true,
			false,
			false,
			false,
			false,
			false,
			false,
		]);
		expect(week.done).toBe(1);
	});

	it("counts completed weeks that met the goal and keeps the all-workouts streak", () => {
		expect(week.recent).toHaveLength(8);
		expect(week.recent.slice(-4).map(({ count }) => count)).toEqual([3, 2, 5, 3]);
		expect(week.goalMet).toBe(3);
		expect(week.streak).toBe(5);
		expect(week.peak).toBe(5);
	});

	it("reports no goal-met weeks without a goal", () => {
		expect(buildWeekProgress({ now, summary, goal: undefined, timeZone: "UTC" }).goalMet).toBe(0);
	});
});

describe("buildMuscleTiles", () => {
	const activity: readonly MuscleActivity[] = [
		{ id: "neck", name: "Neck", weeklySets: 0, lastTrainedAt: null },
		{ id: "lats", name: "Lats", weeklySets: 12, lastTrainedAt: "2026-10-18T10:00:00.000Z" },
		{ id: "chest", name: "Chest", weeklySets: 4.5, lastTrainedAt: "2026-10-21T08:00:00.000Z" },
		{ id: "calves", weeklySets: 0, name: "Calves", lastTrainedAt: "2026-10-14T08:00:00.000Z" },
		{ id: "glutes", weeklySets: 0, name: "Glutes", lastTrainedAt: "2026-10-01T08:00:00.000Z" },
	];

	it("bands days since the last session and labels weekly sets", () => {
		expect(buildMuscleTiles(activity, now, "UTC")).toEqual([
			{ id: "neck", name: "Neck", band: "cold", days: "Never", sets: "No sets this week" },
			{ id: "lats", days: "3d", name: "Lats", band: "fresh", sets: "12 sets" },
			{ days: "0d", id: "chest", name: "Chest", band: "recent", sets: "4.5 sets" },
			{ days: "7d", id: "calves", band: "stale", name: "Calves", sets: "No sets this week" },
			{ days: "20d", id: "glutes", band: "cold", name: "Glutes", sets: "No sets this week" },
		]);
	});

	it("keeps equal-name tiles distinct and describes stabilizer-only recent activity", () => {
		expect(
			buildMuscleTiles(
				[
					{ id: "shared", name: "Chest", weeklySets: 1, lastTrainedAt: "2026-10-14T08:00:00.000Z" },
					{
						id: "private",
						name: "Chest",
						weeklySets: 0,
						lastTrainedAt: "2026-10-21T08:00:00.000Z",
					},
				],
				now,
				"UTC",
			),
		).toEqual([
			{ days: "7d", id: "shared", name: "Chest", band: "stale", sets: "1 set" },
			{ days: "0d", id: "private", name: "Chest", band: "recent", sets: "No sets this week" },
		]);
	});

	it("uses local calendar dates and treats invalid dates as never trained", () => {
		expect(
			buildMuscleTiles(
				[
					{ id: "local", name: "Local", weeklySets: 1, lastTrainedAt: "2026-10-21T00:30:00.000Z" },
					{ id: "invalid", weeklySets: 0, name: "Invalid", lastTrainedAt: "invalid" },
				],
				now,
				"America/Los_Angeles",
			),
		).toEqual([
			{ days: "1d", id: "local", name: "Local", sets: "1 set", band: "recent" },
			{ band: "cold", id: "invalid", days: "Never", name: "Invalid", sets: "No sets this week" },
		]);
	});
});

describe("buildTemplateCards", () => {
	it("keeps the recipe order and describes last session, duration and muscles", () => {
		const cards = buildTemplateCards({
			now,
			timeZone: "UTC",
			targets: [
				{
					id: "squat",
					targets: [
						{ role: "primary", name: "Quadriceps" },
						{ name: "Glutes", role: "secondary" },
						{ name: "Core", role: "stabilizer" },
					],
				},
				{ id: "press", targets: [{ role: null, name: "Shoulders" }] },
			],
			templates: [
				template({ name: "Never done", id: EntityId.make("never") }),
				template({
					name: "Legs",
					id: EntityId.make("legs"),
					lastWorkout: {
						endedAt: null,
						activeDuration: 4860,
						startedAt: "2026-10-15T09:00:00.000Z",
					},
				}),
			],
		});
		expect(cards.map(({ id }) => id)).toEqual(["never", "legs"]);
		expect(cards[0]).toMatchObject({ last: "Never done", meta: "2 exercises" });
		expect(cards[1]).toMatchObject({
			moreChips: 0,
			last: "6 days ago",
			meta: "2 exercises · last took 1h 21m",
			chips: ["Glutes", "Quadriceps", "Shoulders"],
		});
	});
});

describe("draftBanner", () => {
	it("describes a live session with its progress", () => {
		expect(draftBanner(draft({ kind: "live" }), now, "UTC")).toEqual({
			title: "Workout in progress",
			resumeLabel: "Resume workout",
			detail: "Started 11:26 AM · 34 min elapsed · 12 of 28 sets confirmed",
		});
	});

	it("names the edited record for historical and template drafts", () => {
		expect(
			draftBanner(
				draft({ kind: "historical", conflictToken: "c", entityId: EntityId.make("w") }),
				now,
				"UTC",
			),
		).toMatchObject({ title: "Editing workout", resumeLabel: "Resume editing" });
		expect(draftBanner(draft({ kind: "template-create" }), now, "UTC")).toMatchObject({
			detail: "28 sets",
			title: "Editing template",
		});
	});
});

describe("header copy", () => {
	it("formats the local date and the age of the last workout", () => {
		expect(formatHomeDate(now, "UTC")).toBe("Wednesday, 21 October");
		expect(lastWorkoutPhrase("2026-10-19T09:00:00.000Z", now, "UTC")).toBe(
			"last workout 2 days ago",
		);
		expect(lastWorkoutPhrase(null, now, "UTC")).toBeNull();
	});
});
