import { describe, expect, it } from "bun:test";

import { adaptHevyCsv } from "./adapter";

const HEVY_HEADERS =
	"title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds";

describe("adaptHevyCsv", () => {
	it("groups Hevy rows into normalized workouts and exercises", () => {
		const csv = [
			HEVY_HEADERS,
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Bench Press,,Felt strong,1,100,5,normal,,,",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Run,,,1,,,normal,5000,1800",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Push Up,,,1,,12,normal,,,",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Timed Push Up,,,1,,10,normal,,60",
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items.length).toBe(1);
		expect(result.items[0]).toMatchObject({
			name: "Push Day",
			comment: "Good session",
			sourceIdentifier: "2026-01-01T10:00:00:Push Day",
		});
		expect(result.items[0]?.exercises).toEqual([
			{
				name: "Bench Press",
				kind: "reps_and_weight",
				sets: [{ setLot: "normal", note: "Felt strong", reps: 5, weight: 100 }],
			},
			{
				name: "Run",
				kind: "distance_and_duration",
				sets: [{ setLot: "normal", distance: 5, duration: 1800 }],
			},
			{
				name: "Push Up",
				kind: "reps",
				sets: [{ setLot: "normal", reps: 12 }],
			},
			{
				name: "Timed Push Up",
				kind: "reps_and_duration",
				sets: [{ setLot: "normal", reps: 10, duration: 60 }],
			},
		]);
	});

	it("parses the native Hevy date format DD MMM YYYY, HH:mm", () => {
		const csv = [
			HEVY_HEADERS,
			'"Leg Day","01 Jan 2026, 10:00","01 Jan 2026, 11:00",,Squat,,,1,80,5,normal,,,',
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items[0]?.startedAt).toMatch(/^2026-01-01T/);
		expect(result.items[0]?.endedAt).toMatch(/^2026-01-01T/);
	});

	it("maps set types to correct setLot values", () => {
		const csv = [
			HEVY_HEADERS,
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,1,60,10,warmup,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,2,80,5,normal,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,3,90,3,failure,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,4,70,8,dropset,,,",
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.failures).toEqual([]);
		const sets = result.items[0]?.exercises[0]?.sets ?? [];
		expect(sets.map((s) => s.setLot)).toEqual(["warm_up", "normal", "failure", "drop"]);
	});

	it("keeps same-timestamp workouts separate by title", () => {
		const csv = [
			HEVY_HEADERS,
			"Morning,2026-01-01T10:00:00,2026-01-01T11:00:00,,Push Up,,,1,,10,normal,,,",
			"Evening,2026-01-01T10:00:00,2026-01-01T11:00:00,,Squat,,,1,,12,normal,,,",
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items.map((item) => item.name)).toEqual(["Morning", "Evening"]);
		expect(result.items.map((item) => item.sourceIdentifier)).toEqual([
			"2026-01-01T10:00:00:Morning",
			"2026-01-01T10:00:00:Evening",
		]);
	});

	it("converts distance from meters to km", () => {
		const csv = [
			HEVY_HEADERS,
			"Run Day,2026-01-01T09:00:00,2026-01-01T10:00:00,,Run,,,1,,,normal,10000,3600",
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items[0]?.exercises[0]?.sets[0]?.distance).toBe(10);
	});

	it("records item failures for exercises without meaningful set statistics", () => {
		const csv = [
			HEVY_HEADERS,
			"Empty,2026-01-01T10:00:00,2026-01-01T11:00:00,,Mystery,,,1,,,normal,,,",
		].join("\n");

		const result = adaptHevyCsv(csv);

		expect(result.items).toEqual([]);
		expect(result.failures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				sourceLabel: "Exercise: Mystery",
				message: "Could not determine exercise kind from 1 sets",
			}),
			expect.objectContaining({
				itemIndex: 0,
				sourceLabel: "Empty (2026-01-01T10:00:00)",
				message: "Workout has no importable exercises",
			}),
		]);
	});

	it("throws when the CSV has no headers", () => {
		expect(() => adaptHevyCsv("")).toThrow("Hevy CSV is empty or has no header row");
	});
});
