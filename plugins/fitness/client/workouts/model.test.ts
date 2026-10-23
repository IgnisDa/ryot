import { EntityId, EntitySchemaSlug } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import type { WorkoutListItem, WorkoutSummary } from "../../shared/workout-list-recipes";
import { buildHeatmap, buildSummaryTiles, buildWorkoutCards, groupByWeek, weekKey } from "./model";

const now = new Date("2026-10-18T12:00:00.000Z");

const set = (
	exerciseId: string,
	exerciseOrder: number,
	overrides: Partial<WorkoutListItem["sets"][number]> = {},
): WorkoutListItem["sets"][number] => ({
	reps: 5,
	exerciseId,
	oneRm: null,
	weight: 100,
	setOrder: 0,
	exerciseOrder,
	duration: null,
	distance: null,
	personalBests: null,
	exerciseName: exerciseId,
	exerciseKind: "reps_and_weight",
	id: `${exerciseId}-${exerciseOrder}-${overrides.setOrder ?? 0}`,
	...overrides,
});

const workout = (overrides: Partial<WorkoutListItem> = {}): WorkoutListItem => ({
	id: "w1",
	sets: [],
	setCount: 0,
	name: "Legs",
	volume: 1000,
	template: null,
	exerciseCount: 0,
	personalBests: 0,
	activeDuration: 3600,
	repeatedFromId: null,
	previousTemplateWorkoutId: null,
	endedAt: "2026-10-14T18:30:00.000Z",
	startedAt: "2026-10-14T17:00:00.000Z",
	...overrides,
});

const template: NonNullable<WorkoutListItem["template"]> = {
	comment: null,
	name: "Legs B",
	id: EntityId.make("t1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	schemaSlug: EntitySchemaSlug.make("workout-template"),
};

const cards = (items: readonly WorkoutListItem[], imperial = false) =>
	buildWorkoutCards({
		now,
		items,
		imperial,
		targets: [],
		timeZone: "UTC",
		comparisons: [
			{ id: "prior", volume: 800, startedAt: "2026-10-07T17:00:00.000Z" },
			{ volume: 0, id: "empty-prior", startedAt: "2026-10-03T17:00:00.000Z" },
		],
	});

describe("weekKey", () => {
	it("starts weeks on Monday in the viewer's time zone", () => {
		const lateSunday = new Date("2026-10-11T22:30:00.000Z");
		expect(weekKey(lateSunday, "UTC")).toBe("2026-10-05");
		expect(weekKey(lateSunday, "Pacific/Auckland")).toBe("2026-10-12");
	});
});

describe("buildWorkoutCards", () => {
	it("compares with the workout it repeats, the template's previous session, or nothing", () => {
		const [repeated, fromTemplate, firstTemplate, empty] = cards([
			workout({ repeatedFromId: "prior" }),
			workout({ template, previousTemplateWorkoutId: "prior" }),
			workout({ template }),
			workout(),
		]);
		expect(repeated?.comparison).toEqual({
			change: 25,
			kind: "repeated",
			label: "Repeated from Oct 7",
		});
		expect(fromTemplate?.comparison).toEqual({
			change: 25,
			kind: "template",
			label: "Legs B · last Oct 7",
		});
		expect(firstTemplate?.comparison).toEqual({
			change: null,
			kind: "template",
			label: "Legs B · first session",
		});
		expect(empty?.comparison).toEqual({ kind: "none" });
	});

	it("leaves the change out when the earlier workout has no volume", () => {
		expect(cards([workout({ repeatedFromId: "empty-prior" })])[0]?.comparison).toMatchObject({
			change: null,
		});
	});

	it("shows each exercise's best set in workout order and marks record exercises", () => {
		const [card] = cards([
			workout({
				sets: [
					set("squat", 0, { reps: 5, oneRm: 116, weight: 100 }),
					set("squat", 0, {
						reps: 3,
						oneRm: 120,
						setOrder: 1,
						weight: 110,
						personalBests: ["weight"],
					}),
					set("press", 1, { reps: 10, weight: 200 }),
					set("lunge", 2, { reps: 12, weight: 20 }),
					set("curl", 3, { reps: 12, weight: 50 }),
				],
			}),
		]);
		expect(card?.top).toEqual([
			{ sets: 2, record: true, name: "squat", key: "0:squat", best: "110 kg × 3" },
			{ sets: 1, name: "press", record: false, key: "1:press", best: "200 kg × 10" },
			{ sets: 1, name: "lunge", record: false, key: "2:lunge", best: "20 kg × 12" },
		]);
		expect(card?.moreExercises).toBe(1);
	});

	it("labels timestamp time as elapsed when active duration is unknown", () => {
		expect(cards([workout({ activeDuration: null })])[0]?.duration).toEqual({
			value: "1h 30m",
			label: "Elapsed",
		});
		expect(cards([workout()])[0]?.duration).toEqual({ value: "1h", label: "Duration" });
	});

	it("shows volume in the display unit system", () => {
		expect(cards([workout({ volume: 14820 })])[0]?.volume).toBe("14,820 kg");
		expect(cards([workout({ volume: 100 })], true)[0]?.volume).toBe("220 lb");
	});
});

describe("groupByWeek", () => {
	it("titles the current and previous weeks and attaches their totals", () => {
		const sections = groupByWeek({
			now,
			imperial: false,
			timeZone: "UTC",
			totals: [
				{
					workouts: 3,
					volume: 34700,
					personalBests: 1,
					timedWorkouts: 3,
					activeDuration: 16980,
					at: "2026-10-12T00:00:00.000Z",
				},
			],
			cards: cards([
				workout({ id: "a", startedAt: "2026-10-14T17:00:00.000Z" }),
				workout({ id: "b", startedAt: "2026-10-08T17:00:00.000Z" }),
				workout({ id: "c", startedAt: "2026-09-29T17:00:00.000Z" }),
			]),
		});
		expect(sections.map(({ title, range, totals }) => ({ title, range, totals }))).toEqual([
			{ title: "This week", range: "Oct 12 – 18", totals: "3 workouts · 4h 43m · 34.7K kg · 1 PR" },
			{ totals: null, title: "Last week", range: "Oct 5 – 11" },
			{ range: null, totals: null, title: "Sep 28 – Oct 4" },
		]);
	});
});

const totals = (volume: number, workouts: number) => ({
	volume,
	workouts,
	personalBests: 0,
	timedWorkouts: workouts,
	activeDuration: workouts * 3600,
});

const summary = (overrides: Partial<WorkoutSummary> = {}): WorkoutSummary => ({
	days: [],
	latestRecord: null,
	current: totals(1100, 4),
	previous: totals(1000, 4),
	...overrides,
});

const trained = (at: string) => ({ at, ...totals(500, 1) });

describe("buildHeatmap", () => {
	it("counts the streak through the last trained week and leaves future days empty", () => {
		const heatmap = buildHeatmap(
			summary({
				days: [
					trained("2026-09-30T00:00:00.000Z"),
					trained("2026-10-07T00:00:00.000Z"),
					trained("2026-10-14T00:00:00.000Z"),
				],
			}),
			new Date("2026-10-15T12:00:00.000Z"),
			"UTC",
		);
		expect(heatmap.streak).toBe(3);
		expect(heatmap.weeks.at(-1)?.cells.map(({ level }) => level)).toEqual([
			0,
			0,
			1,
			0,
			null,
			null,
			null,
		]);
	});
});

describe("buildSummaryTiles", () => {
	it("compares volume with the previous period", () => {
		expect(buildSummaryTiles(summary(), "1M", false)[2]).toEqual({
			tone: "up",
			label: "Volume",
			value: "1.1K kg",
			detail: "▲ 10% vs previous 30 days",
		});
		expect(buildSummaryTiles(summary({ previous: totals(0, 0) }), "1M", false)[2]?.detail).toBe(
			"Nothing to compare yet",
		);
	});
});
