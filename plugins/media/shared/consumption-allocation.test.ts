import { Schema } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import {
	allocateConsumptionObservation,
	type ConsumptionAllocation,
	ConsumptionObservation,
	type ConsumptionRunCursor,
	consumptionRunForObservation,
	emptyConsumptionAllocationState,
	emptyConsumptionRunPlan,
	planConsumptionObservation,
} from "./consumption-allocation";

const observation = (
	id: string,
	properties: Partial<ConsumptionObservation["properties"]> = {},
	options: Partial<Omit<ConsumptionObservation, "id" | "properties">> = {},
): ConsumptionObservation => ({
	id,
	entityId: "book",
	closesRun: false,
	entitySchemaSlug: "book",
	eventSchemaSlug: "progress",
	occurredAt: "2026-01-01T12:00:00.000Z",
	...options,
	properties: { consumptionBasis: { total: 100, unit: "pages", property: "pages" }, ...properties },
});

const timed = (id: string, timeSpent?: number): ConsumptionObservation =>
	observation(
		id,
		{ consumptionBasis: { unit: "minutes" }, ...(timeSpent === undefined ? {} : { timeSpent }) },
		{ entityId: "game", entitySchemaSlug: "video-game" },
	);

const movie = (
	id: string,
	properties: Partial<ConsumptionObservation["properties"]>,
	complete = false,
): ConsumptionObservation =>
	observation(
		id,
		{ consumptionBasis: { total: 200, unit: "minutes", property: "runtime" }, ...properties },
		{
			entityId: "movie",
			entitySchemaSlug: "movie",
			eventSchemaSlug: complete ? "complete" : "progress",
		},
	);

const allocate = (history: readonly ConsumptionObservation[]) => {
	const cursors = new Map<string, ConsumptionRunCursor>();
	const runs = new Map<string, ConsumptionObservation[]>();
	for (const event of history) {
		const next = consumptionRunForObservation(
			cursors.get(event.entityId) ?? { runKey: null, closedBy: null },
			event,
		);
		cursors.set(event.entityId, next.cursor);
		const run = runs.get(next.runKey) ?? [];
		run.push(event);
		runs.set(next.runKey, run);
	}
	const results = new Map<string, ConsumptionAllocation>();
	for (const run of runs.values()) {
		const plan = run.reduce(planConsumptionObservation, emptyConsumptionRunPlan());
		let state = emptyConsumptionAllocationState();
		for (const event of run) {
			const next = allocateConsumptionObservation(plan, state, event);
			state = next.state;
			results.set(event.id, next.allocation);
		}
	}
	return history.map((event) => {
		const result = results.get(event.id);
		if (result === undefined) {
			throw new Error("Missing allocation");
		}
		return result;
	});
};

const quantity = (rows: readonly ConsumptionAllocation[], unit = "pages") =>
	rows.flatMap((row) => row.quantities.filter((value) => value.unit === unit));
const amounts = (rows: readonly ConsumptionAllocation[], unit = "pages") =>
	quantity(rows, unit).map((value) => value.recorded + value.estimated);

describe("canonical consumption allocation", () => {
	it("counts exact pages followed by a frozen completion remainder", () => {
		const result = allocate([
			observation("40", { progressPages: 40 }),
			observation("70", { progressPages: 70 }),
			observation("done", {}, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([40, 30, 30]);
		expect(
			quantity(result).map((value) => [value.recorded, value.estimated, value.missing]),
		).toEqual([
			[40, 0, false],
			[30, 0, false],
			[0, 30, false],
		]);
		expect(result.map((row) => row.titleCompletions)).toEqual([0, 0, 1]);
	});
	it("sums increases in recorded game time, not cumulative totals", () => {
		expect(
			amounts(allocate([timed("2h", 120), timed("5h", 300), timed("8h", 480)]), "minutes"),
		).toEqual([120, 180, 180]);
	});
	it("uses readings outside a report window before selecting dates", () => {
		const result = allocate([
			observation("before", { progressPages: 40 }, { occurredAt: "2025-12-31T12:00:00.000Z" }),
			observation("inside", { progressPages: 70 }),
		]);
		expect(
			amounts(
				result.filter(
					(row) => row.attribution.kind === "instant" && row.attribution.value >= "2026-01-01",
				),
			),
		).toEqual([30]);
	});
	it("duplicates and lower readings add nothing; edit and delete replay later differences", () => {
		const first = observation("first", { progressPages: 40 });
		const next = observation("next", { progressPages: 70 });
		const done = observation("done", {}, { eventSchemaSlug: "complete" });
		expect(
			amounts(
				allocate([
					first,
					next,
					observation("duplicate", { progressPages: 70 }),
					observation("lower", { progressPages: 20 }),
					done,
				]),
			),
		).toEqual([40, 30, 0, 0, 30]);
		expect(amounts(allocate([observation("first", { progressPages: 90 }), next, done]))).toEqual([
			90, 0, 10,
		]);
		expect(amounts(allocate([next, done]))).toEqual([70, 30]);
	});
	it("a metadata change alone does not make a duplicate or lower position active", () => {
		const result = allocate([
			observation("first", { progressPages: 40 }),
			observation("duplicate", {
				progressPages: 40,
				consumptionBasis: { total: 50, unit: "pages", property: "pages" },
			}),
			observation("lower", {
				progressPages: 20,
				consumptionBasis: { total: 10, unit: "pages", property: "pages" },
			}),
		]);
		expect(amounts(result)).toEqual([40, 0, 0]);
		expect(result.map((row) => row.activeObservation)).toEqual([true, false, false]);
	});
	it("values each newly observed percentage interval with its own frozen denominator", () => {
		const result = allocate([
			observation("40", { progressPercent: 40 }),
			observation("same", {
				progressPercent: 40,
				consumptionBasis: { total: 200, unit: "pages", property: "pages" },
			}),
			observation("70", {
				progressPercent: 70,
				consumptionBasis: { total: 200, unit: "pages", property: "pages" },
			}),
			observation(
				"done",
				{ consumptionBasis: { total: 200, unit: "pages", property: "pages" } },
				{ eventSchemaSlug: "complete" },
			),
		]);
		expect(amounts(result)).toEqual([40, 0, 60, 60]);
	});
	it("does not use a later denominator to fill an unknown initial interval", () => {
		const result = allocate([
			observation("unknown", {
				progressPercent: 40,
				consumptionBasis: { unit: "pages", property: "pages" },
			}),
			observation("70", { progressPercent: 70 }),
			observation("done", {}, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([0, 30, 30]);
		expect(quantity(result).map((value) => value.missing)).toEqual([true, false, false]);
	});
	it("a later exact reading replaces earlier estimated allocation without inventing dates", () => {
		const result = allocate([
			observation("estimated", { progressPercent: 40 }),
			observation("recorded", { progressPages: 70, calendarDate: "2026-01-04" }),
			observation("done", {}, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([0, 70, 30]);
		expect(quantity(result)[0]).toMatchObject({ missing: false, supersededEstimate: true });
		expect(result[1]?.attribution).toEqual({ kind: "date", value: "2026-01-04" });
		expect(result[0]?.activeObservation).toBe(true);
	});
	it("manual time replaces estimates, including an explicit corrected total below the estimate", () => {
		const first = movie("estimate", { progressPercent: 90 });
		const result = allocate([first, movie("recorded", { timeSpent: 120 }, true)]);
		expect(amounts(result, "minutes")).toEqual([0, 120]);
		expect(quantity(result, "minutes")[0]).toMatchObject({ supersededEstimate: true });
		expect(
			amounts(allocate([first, movie("recorded", { timeSpent: 60 }, true)]), "minutes"),
		).toEqual([0, 60]);
		expect(first.properties.consumptionBasis.total).toBe(200);
	});
	it("does not invent remaining time after the last manual reading", () => {
		const result = allocate([
			movie("recorded", { timeSpent: 120, progressPercent: 50 }),
			movie("done", {}, true),
		]);
		expect(amounts(result, "minutes")).toEqual([120, 0]);
		expect(quantity(result, "minutes")[1]).toMatchObject({
			missing: true,
			supersededEstimate: false,
		});
	});
	it("lower manual readings cannot erase earlier recorded time", () => {
		expect(
			amounts(
				allocate([timed("high", 300), timed("lower", 120), timed("duplicate", 300)]),
				"minutes",
			),
		).toEqual([300, 0, 0]);
	});
	it("knows an exact remainder even when the earlier exact reading had no denominator", () => {
		expect(
			amounts(
				allocate([
					observation("40", {
						progressPages: 40,
						consumptionBasis: { unit: "pages", property: "pages" },
					}),
					observation("done", {}, { eventSchemaSlug: "complete" }),
				]),
			),
		).toEqual([40, 60]);
	});
	it("keeps known zero distinct from unknown quantities and imported unknown dates", () => {
		const result = allocate([
			movie(
				"unknown",
				{ dateUnknown: true, consumptionBasis: { unit: "minutes", property: "runtime" } },
				true,
			),
			movie("zero", { timeSpent: 0 }, true),
		]);
		expect(
			quantity(result, "minutes").map((value) => [value.recorded, value.estimated, value.missing]),
		).toEqual([
			[0, 0, true],
			[0, 0, false],
		]);
		expect(result[0]?.attribution).toEqual({ kind: "unknown" });
		expect(result.map((row) => row.titleCompletions)).toEqual([1, 1]);
	});
	it("keeps frozen values through serialization and ignores current provider data", () => {
		const history = [movie("first", { progressPercent: 50 }), movie("done", {}, true)];
		const restored = Schema.decodeSync(Schema.fromJsonString(Schema.Array(ConsumptionObservation)))(
			JSON.stringify(history),
		);
		expect(allocate(restored)).toEqual(allocate(history));
		expect(amounts(allocate(restored), "minutes")).toEqual([100, 100]);
	});
	it("counts full progress plus automatic completion once, then an independent repeat", () => {
		const result = allocate([
			observation("full", { progressPages: 100 }, { closesRun: true }),
			observation(
				"auto",
				{},
				{ eventSchemaSlug: "complete", automatic: { rule: "progress", sourceEventId: "full" } },
			),
			observation("repeat", {}, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([100, 100]);
		expect(result.map((row) => row.titleCompletions)).toEqual([0, 1, 1]);
		expect(result[1]?.activeObservation).toBe(false);
	});
	it("retains a suppressed boundary without counting a deleted completion", () => {
		const result = allocate([
			observation("suppressed", { progressPages: 100 }, { closesRun: true }),
			observation("repeat-start", { progressPages: 20 }),
			observation("repeat-done", {}, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([100, 20, 80]);
		expect(result.map((row) => row.titleCompletions)).toEqual([0, 0, 1]);
	});
	it("an explicit override closes its source run without a second quantity", () => {
		const result = allocate([
			observation("full", { progressPages: 100 }),
			observation("override", { calendarDate: "2026-01-05" }, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([100, 0]);
		expect(result[1]?.titleCompletions).toBe(1);
	});
	it("keeps interleaved explicit source runs independent", () => {
		const result = allocate([
			observation("a40", { sourceRun: "a", progressPages: 40 }),
			observation("b-done", { sourceRun: "b" }, { eventSchemaSlug: "complete" }),
			observation("a70", { sourceRun: "a", progressPages: 70 }),
			observation("a-done", { sourceRun: "a" }, { eventSchemaSlug: "complete" }),
		]);
		expect(amounts(result)).toEqual([40, 100, 30, 30]);
	});
	it("preserves numbered anime repeats without cumulative progress or title completions", () => {
		const result = allocate(
			["seen:a", "seen:b"].map((id) =>
				observation(
					id,
					{
						sourceRun: id,
						consumedItem: { position: 12, unit: "episodes" },
						consumptionBasis: { total: 12, unit: "episodes", property: "episodes" },
					},
					{ entityId: "anime", entitySchemaSlug: "anime", eventSchemaSlug: "item-complete" },
				),
			),
		);
		expect(amounts(result, "episodes")).toEqual([1, 1]);
		expect(result.map((row) => row.titleCompletions)).toEqual([0, 0]);
		expect(result.map((row) => row.activeObservation)).toEqual([true, true]);
	});
	it("chapter and volume occurrences stay separate and volume context is not quantity", () => {
		const result = allocate([
			observation(
				"chapter",
				{
					consumedItem: { volume: 7, position: 42.5, unit: "chapters" },
					consumptionBasis: { total: 50, unit: "chapters", property: "chapters" },
				},
				{ entitySchemaSlug: "manga", eventSchemaSlug: "item-complete" },
			),
			observation(
				"volume",
				{
					consumedItem: { position: 8, unit: "volumes" },
					consumptionBasis: { total: 50, unit: "chapters", property: "chapters" },
				},
				{ entitySchemaSlug: "manga", eventSchemaSlug: "item-complete" },
			),
		]);
		expect(amounts(result, "chapters")).toEqual([1]);
		expect(amounts(result, "volumes")).toEqual([1]);
		expect(result.map((row) => row.titleCompletions)).toEqual([0, 0]);
	});
	it("an item occurrence does not reset or advance an unrelated cumulative run", () => {
		const basis = { total: 24, unit: "episodes", property: "episodes" } as const;
		const options = { entityId: "anime", entitySchemaSlug: "anime" };
		const result = allocate([
			observation("3", { animeEpisode: 3, consumptionBasis: basis }, options),
			observation(
				"item17",
				{ consumptionBasis: basis, consumedItem: { position: 17, unit: "episodes" } },
				{ ...options, eventSchemaSlug: "item-complete" },
			),
			observation("5", { animeEpisode: 5, consumptionBasis: basis }, options),
		]);
		expect(amounts(result, "episodes")).toEqual([3, 1, 2]);
	});
	it("preserves ambiguous source progress without treating it as consumption", () => {
		const result = allocate([
			observation(
				"ambiguous",
				{
					sourceProgress: { percent: 50, position: 12, unit: "episodes" },
					consumptionBasis: { total: 24, unit: "episodes", property: "episodes" },
				},
				{ entitySchemaSlug: "anime" },
			),
		]);
		expect(result[0]).toMatchObject({
			quantities: [],
			titleCompletions: 0,
			activeObservation: false,
		});
	});
	it("retains partial volume-only evidence without treating the numbered volume as consumed", () => {
		const result = allocate([
			observation(
				"partial-volume",
				{
					consumptionBasis: { unit: "chapters", property: "chapters" },
					sourceProgress: { position: 3, percent: 50, unit: "volumes" },
				},
				{ entitySchemaSlug: "manga" },
			),
		]);
		expect(result[0]).toMatchObject({
			quantities: [],
			titleCompletions: 0,
			activeObservation: false,
		});
	});
	it("keeps regular and special child minutes when parent completion is suppressed", () => {
		const child = (id: string, total: number) =>
			observation(
				id,
				{ consumptionBasis: { total, unit: "minutes", property: "runtime" } },
				{ entityId: id, eventSchemaSlug: "complete", entitySchemaSlug: "show-episode" },
			);
		const children = [child("regular", 30), child("special", 20)];
		const parent = observation(
			"parent",
			{ timeSpent: 50, consumptionBasis: { unit: "episodes" } },
			{
				entityId: "show",
				entitySchemaSlug: "show",
				eventSchemaSlug: "complete",
				automatic: { rule: "coverage", sourceEventId: "regular" },
			},
		);
		expect(amounts(allocate([...children, parent]), "minutes")).toEqual([30, 20]);
		expect(amounts(allocate(children), "minutes")).toEqual([30, 20]);
		expect(allocate(children).map((row) => row.episodeCompletions)).toEqual([1, 1]);
	});
	it("status changes and starting without a quantity are not active consumption", () => {
		const result = allocate([
			observation("start"),
			observation("hold", {}, { eventSchemaSlug: "on_hold" }),
			observation("drop", {}, { eventSchemaSlug: "dropped" }),
		]);
		expect(result.map((row) => [row.activeObservation, row.quantities])).toEqual([
			[false, []],
			[false, []],
			[false, []],
		]);
	});
	it("keeps planning and replay state bounded for a long unfinished run", () => {
		let plan = emptyConsumptionRunPlan();
		for (let index = 0; index < 10000; index += 1) {
			plan = planConsumptionObservation(plan, timed(String(index), index));
		}
		let state = emptyConsumptionAllocationState();
		let total = 0;
		for (let index = 0; index < 10000; index += 1) {
			const next = allocateConsumptionObservation(plan, state, timed(String(index), index));
			state = next.state;
			total += next.allocation.quantities[0]?.recorded ?? 0;
		}
		expect(total).toBe(9999);
		expect(JSON.stringify({ plan, state }).length).toBeLessThan(1024);
	});
	it("keeps thousands of interleaved source runs on one title independent", () => {
		const history: ConsumptionObservation[] = [];
		for (let index = 0; index < 1500; index += 1) {
			history.push(observation(`start:${index}`, { progressPages: 40, sourceRun: `run:${index}` }));
		}
		for (let index = 0; index < 1500; index += 1) {
			history.push(
				observation(`end:${index}`, { sourceRun: `run:${index}` }, { eventSchemaSlug: "complete" }),
			);
		}
		const result = allocate(history);
		expect(amounts(result).reduce((sum, value) => sum + value, 0)).toBe(150000);
		expect(result.reduce((sum, row) => sum + row.titleCompletions, 0)).toBe(1500);
		expect(amounts(result.slice(1500))).toEqual(Array.from({ length: 1500 }, () => 60));
	});
	it("does not convert manga volume context into consumed volume quantities", () => {
		const result = allocate([
			observation(
				"chapter",
				{
					mangaVolume: 3,
					mangaChapter: 10,
					consumptionBasis: { unit: "chapters", property: "chapters" },
				},
				{ entitySchemaSlug: "manga" },
			),
		]);
		expect(amounts(result, "chapters")).toEqual([10]);
		expect(quantity(result, "volumes")).toEqual([]);
	});
});
