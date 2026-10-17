import { describe, expect, it } from "vitest";

import { buildWorkoutSetEventProperties } from "../../shared/workout-set";
import { parseCsvText } from "./csv";
import { adaptHevyRows } from "./hevy";

const indexedRows = (csv: string) =>
	parseCsvText(csv).rows.map((row, itemIndex) => ({ row, itemIndex }));

const HEVY_HEADERS =
	"title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds";

describe("adaptHevyRows", () => {
	it("uses the first valid row for workout metadata and keeps interleaved exercise sets in source order", () => {
		const result = adaptHevyRows(
			indexedRows(
				[
					HEVY_HEADERS,
					"Session,2026-01-01T10:00:00,2026-01-01T12:00:00,Invalid,Bench Press,,,1,bad,5,normal,,,",
					"Session,2026-01-01T10:00:00,2026-01-01T11:00:00,First valid,Bench Press,,First set,3,90,5,warmup,,,",
					"Session,2026-01-01T10:00:00,2026-01-01T12:00:00,Later,Push Up,,,1,,10,normal,,,",
					"Session,2026-01-01T10:00:00,2026-01-01T12:00:00,Later,Bench Press,,Last set,2,100,4,failure,,,",
				].join("\n"),
			),
			"Etc/GMT",
		);

		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				unit: "workouts",
				sourceLabel: "Row 1",
				sourceIdentifier: "1",
				message: 'Could not parse numeric value "bad"',
			},
		]);
		expect(result.item).toMatchObject({
			itemIndex: 1,
			name: "Session",
			comment: "First valid",
			endedAt: "2026-01-01T11:00:00.000Z",
			startedAt: "2026-01-01T10:00:00.000Z",
			sourceIdentifier: "2026-01-01T10:00:00:Session",
			exercises: [
				{
					name: "Bench Press",
					sets: [
						{ reps: 5, weight: 90, setLot: "warm_up", note: "First set" },
						{ reps: 4, weight: 100, note: "Last set", setLot: "failure" },
					],
				},
				{ name: "Push Up", sets: [{ reps: 10, setLot: "normal" }] },
			],
		});
	});

	it("returns only original row failures when every row is malformed", () => {
		const result = adaptHevyRows(
			[
				{ row: {}, itemIndex: 7 },
				{ itemIndex: 12, row: { weight_kg: "bad" } },
			],
			"Etc/GMT",
		);

		expect(result).toEqual({
			failures: [
				{
					itemIndex: 7,
					unit: "workouts",
					sourceLabel: "Row 8",
					sourceIdentifier: "8",
					message: "Row is missing Title",
				},
				{
					itemIndex: 12,
					unit: "workouts",
					sourceLabel: "Row 13",
					sourceIdentifier: "13",
					message: 'Could not parse numeric value "bad"',
				},
			],
		});
		expect(adaptHevyRows([], "Etc/GMT")).toEqual({ failures: [] });
	});

	it("normalizes one Hevy workout and groups its exercises", () => {
		const csv = [
			HEVY_HEADERS,
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Bench Press,,Felt strong,1,100,5,normal,,,",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Run,,,1,,,normal,5000,1800",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Push Up,,,1,,12,normal,,,",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:03:43,Good session,Timed Push Up,,,1,,10,normal,,60",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item).not.toHaveProperty("activeDuration");
		expect(result.item).toMatchObject({
			name: "Push Day",
			comment: "Good session",
			sourceIdentifier: "2026-01-01T10:00:00:Push Day",
		});
		expect(result.item?.exercises).toEqual([
			{
				name: "Bench Press",
				kind: "reps_and_weight",
				sets: [{ reps: 5, weight: 100, setLot: "normal", note: "Felt strong" }],
			},
			{
				name: "Run",
				kind: "distance_and_duration",
				sets: [{ distance: 5, duration: 1800, setLot: "normal" }],
			},
			{ kind: "reps", name: "Push Up", sets: [{ reps: 12, setLot: "normal" }] },
			{
				name: "Timed Push Up",
				kind: "reps_and_duration",
				sets: [{ reps: 10, duration: 60, setLot: "normal" }],
			},
		]);
	});

	it("parses the native Hevy date format DD MMM YYYY, HH:mm", () => {
		const csv = [
			HEVY_HEADERS,
			'"Leg Day","01 Jan 2026, 10:00","01 Jan 2026, 11:00",,Squat,,,1,80,5,normal,,,',
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.startedAt).toMatch(/^2026-01-01T/);
		expect(result.item?.endedAt).toMatch(/^2026-01-01T/);
	});

	it("parses the current Hevy date format MMM D, YYYY, h:mm AM/PM", () => {
		const csv = [
			HEVY_HEADERS,
			'"Leg Day","Jul 5, 2026, 10:21 AM","Jul 5, 2026, 1:04 PM",,Squat,,,1,80,5,normal,,,',
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.startedAt).toMatch(/^2026-07-05T10:21/);
		expect(result.item?.endedAt).toMatch(/^2026-07-05T13:04/);
	});

	it("maps set types to correct setLot values", () => {
		const csv = [
			HEVY_HEADERS,
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,1,60,10,warmup,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,2,80,5,normal,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,3,90,3,failure,,,",
			"Workout,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,4,70,8,dropset,,,",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		const sets = result.item?.exercises[0]?.sets ?? [];
		expect(sets.map((s) => s.setLot)).toEqual(["warm_up", "normal", "failure", "drop"]);
	});

	it("converts distance from meters to km", () => {
		const csv = [
			HEVY_HEADERS,
			"Run Day,2026-01-01T09:00:00,2026-01-01T10:00:00,,Run,,,1,,,normal,10000,3600",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.exercises[0]?.sets[0]?.distance).toBe(10);
	});

	it("converts weight from pounds to kg", () => {
		const csv = [
			"title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_lbs,reps,set_type,distance_m,duration_seconds",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,,Bench Press,,,1,220.462262,5,normal,,,",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.exercises[0]?.sets[0]?.weight).toBeCloseTo(100, 5);
	});

	it("preserves explicit zero weights and converts labelled km distances", () => {
		const csv = [
			"title,start_time,end_time,exercise_title,set_order,Weight (kg),Reps,set_type,Distance (km),Duration (seconds)",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Bodyweight Squat,1,0,5,normal,,",
			"Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Run,1,,,normal,1.5,900",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.exercises).toEqual([
			{
				kind: "reps_and_weight",
				name: "Bodyweight Squat",
				sets: [{ reps: 5, weight: 0, setLot: "normal" }],
			},
			{
				name: "Run",
				kind: "distance_and_duration",
				sets: [{ distance: 1.5, duration: 900, setLot: "normal" }],
			},
		]);
	});

	it("selects event measurements for the exercise kind and writes no derived statistics", () => {
		const properties = buildWorkoutSetEventProperties({
			reps: 5,
			weight: 100,
			distance: 2,
			setOrder: 0,
			duration: 60,
			setLot: "normal",
			exerciseOrder: 0,
			exerciseKind: "reps",
		});

		expect(properties).toMatchObject({ reps: 5, setOrder: 0, exerciseOrder: 0 });
		for (const omitted of ["weight", "duration", "distance", "volume", "pace", "oneRm"]) {
			expect(properties).not.toHaveProperty(omitted);
		}
	});

	it("records item failures for exercises without meaningful set statistics", () => {
		const csv = [
			HEVY_HEADERS,
			"Empty,2026-01-01T10:00:00,2026-01-01T11:00:00,,Mystery,,,1,,,normal,,,",
		].join("\n");

		const result = adaptHevyRows(indexedRows(csv), "Etc/GMT");

		expect(result.item).toBeUndefined();
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
});
