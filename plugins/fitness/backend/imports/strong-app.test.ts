import { describe, expect, it } from "vitest";

import { parseCsvText } from "./csv";
import { adaptStrongAppRows } from "./strong-app";

const indexedRows = (csv: string) =>
	parseCsvText(csv).rows.map((row, itemIndex) => ({ row, itemIndex }));

describe("adaptStrongAppRows", () => {
	it("uses the first valid nonignored row for metadata and preserves exercise and set order", () => {
		const result = adaptStrongAppRows(
			indexedRows(
				[
					"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Notes,Workout Notes",
					"2026-01-01 10:00:00,Session,unknown,Bench Press,Rest Timer,,,,Ignored rest",
					"2026-01-01 10:00:00,Session,unknown,Bench Press,Note,,,,Ignored note",
					"2026-01-01 10:00:00,Session,7200,Bench Press,1,bad,5,,Malformed",
					"2026-01-01 10:00:00,Session,3600,Bench Press,W,90,5,First set,First valid",
					"2026-01-01 10:00:00,Session,7200,Push Up,1,,10,,Later",
					"2026-01-01 10:00:00,Session,7200,Bench Press,F,100,4,Last set,Later",
				].join("\n"),
			),
			"Etc/GMT",
		);

		expect(result.failures).toEqual([
			{
				itemIndex: 2,
				unit: "workouts",
				sourceLabel: "Row 3",
				sourceIdentifier: "3",
				message: 'Could not parse numeric value "bad"',
			},
		]);
		expect(result.item).toMatchObject({
			itemIndex: 3,
			name: "Session",
			activeDuration: 3600,
			comment: "First valid",
			endedAt: "2026-01-01T11:00:00.000Z",
			startedAt: "2026-01-01T10:00:00.000Z",
			sourceIdentifier: "2026-01-01 10:00:00:Session",
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
		const result = adaptStrongAppRows(
			[
				{ row: {}, itemIndex: 7 },
				{ itemIndex: 12, row: { "Weight (kg)": "bad" } },
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
					message: "Row is missing Date",
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
		expect(adaptStrongAppRows([], "Etc/GMT")).toEqual({ failures: [] });
	});

	it("produces no workout for a group containing only rest and note rows", () => {
		const rows = indexedRows(
			[
				"Date,Workout Name,Duration,Exercise Name,Set Order",
				"2026-01-01 10:00:00,Session,unknown,Bench Press,Rest Timer",
				"2026-01-01 10:00:00,Session,unknown,Bench Press,Note",
			].join("\n"),
		);

		expect(adaptStrongAppRows(rows, "Etc/GMT")).toEqual({ failures: [] });
	});

	it.each([
		["0", 0],
		["60", 60],
		["1.5m 0.9s", 90],
	])("records the reported session duration %s in whole seconds", (duration, expected) => {
		const result = adaptStrongAppRows(
			indexedRows(
				[
					"Date,Workout Name,Duration,Exercise Name,Set Order,Reps",
					`2026-01-01 10:00:00,Session,${duration},Push Up,1,10`,
				].join("\n"),
			),
			"Etc/GMT",
		);
		expect(result.failures).toEqual([]);
		expect(result.item?.activeDuration).toBe(expected);
	});

	it.each(["unknown", "-60", "-1h", "Infinity", "1h trailing", "1e309h"])(
		"reports an invalid session duration %s instead of recording zero",
		(duration) => {
			const result = adaptStrongAppRows(
				indexedRows(
					[
						"Date,Workout Name,Duration,Exercise Name,Set Order,Reps",
						`2026-01-01 10:00:00,Session,${duration},Push Up,1,10`,
					].join("\n"),
				),
				"Etc/GMT",
			);
			expect(result.item).toBeUndefined();
			expect(result.failures).toEqual([
				expect.objectContaining({ message: `Could not parse workout duration "${duration}"` }),
			]);
		},
	);
	it("normalizes one semicolon StrongApp workout and groups its exercises", () => {
		const csv = [
			"Date;Workout Name;Duration;Exercise Name;Set Order;Weight (kg);Reps;Distance (m);Seconds;Notes;Workout Notes",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Bench Press;1;100;5;;;Felt strong;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Run;1;;;5000;1800;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Push Up;1;0;12;;;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Timed Push Up;1;;10;;60;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Bench Press;Rest Timer;;;;;;Good session",
		].join("\n");

		const result = adaptStrongAppRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item).toMatchObject({
			name: "Push Day",
			activeDuration: 3723,
			comment: "Good session",
			endedAt: "2026-01-01T11:02:03.000Z",
			sourceIdentifier: "2026-01-01 10:00:00:Push Day",
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
			{
				name: "Push Up",
				kind: "reps_and_weight",
				sets: [{ reps: 12, weight: 0, setLot: "normal" }],
			},
			{
				name: "Timed Push Up",
				kind: "reps_and_duration",
				sets: [{ reps: 10, duration: 60, setLot: "normal" }],
			},
		]);
	});

	it("converts labelled pounds, kilometres, and miles to metric measurements", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (lbs),Reps,Distance (km),Distance (mi),Seconds",
			"2026-01-01 10:00:00,Labels,60,Bench Press,1,220.462262,5,,,",
			"2026-01-01 10:00:00,Labels,60,Run Km,1,,,1.5,,900",
			"2026-01-01 10:00:00,Labels,60,Run Miles,1,,,,1,900",
		].join("\n");

		const result = adaptStrongAppRows(indexedRows(csv), "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.item?.exercises).toEqual([
			{
				name: "Bench Press",
				kind: "reps_and_weight",
				sets: [{ reps: 5, setLot: "normal", weight: expect.closeTo(100, 5) }],
			},
			{
				name: "Run Km",
				kind: "distance_and_duration",
				sets: [{ duration: 900, distance: 1.5, setLot: "normal" }],
			},
			{
				name: "Run Miles",
				kind: "distance_and_duration",
				sets: [{ duration: 900, setLot: "normal", distance: 1.609344 }],
			},
		]);
	});

	it("reports actionable row failures for nonempty unlabelled measurements", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Distance,Reps,Seconds",
			"2026-01-01 10:00:00,Unlabelled,60,Bench Press,1,100,,5,,",
			"2026-01-01 10:00:00,Unlabelled,60,Run,1,,1000,,60",
		].join("\n");

		const result = adaptStrongAppRows(indexedRows(csv), "Etc/GMT");

		expect(result.item).toBeUndefined();
		expect(result.failures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				sourceLabel: "Row 1",
				message: 'Weight values need a unit label; use "Weight (kg)" or "Weight (lbs)"',
			}),
			expect.objectContaining({
				itemIndex: 1,
				sourceLabel: "Row 2",
				message:
					'Distance values need a unit label; use "Distance (m)", "Distance (km)", or "Distance (mi)"',
			}),
		]);
	});

	it("records item failures for exercises without meaningful set statistics", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance (m),Seconds,Notes,Workout Notes",
			"2026-01-01 10:00:00,Empty,60,Mystery,1,,,,,,",
		].join("\n");

		const result = adaptStrongAppRows(indexedRows(csv), "Etc/GMT");

		expect(result.item).toBeUndefined();
		expect(result.failures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				sourceLabel: "Exercise: Mystery",
				message: "Could not determine exercise kind from 1 sets",
			}),
			expect.objectContaining({
				itemIndex: 0,
				sourceLabel: "Empty (2026-01-01 10:00:00)",
				message: "Workout has no importable exercises",
			}),
		]);
	});
});
