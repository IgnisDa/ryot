import { describe, expect, it } from "vitest";

import { adaptStrongAppCsv } from "./strong-app";

describe("adaptStrongAppCsv", () => {
	it("groups semicolon StrongApp rows into normalized workouts and exercises", () => {
		const csv = [
			"Date;Workout Name;Duration;Exercise Name;Set Order;Weight (kg);Reps;Distance (m);Seconds;Notes;Workout Notes",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Bench Press;1;100;5;;;Felt strong;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Run;1;;;5000;1800;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Push Up;1;0;12;;;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Timed Push Up;1;;10;;60;;Good session",
			"2026-01-01 10:00:00;Push Day;1h 2m 3s;Bench Press;Rest Timer;;;;;;Good session",
		].join("\n");

		const result = adaptStrongAppCsv(csv, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.items.length).toBe(1);
		expect(result.items[0]).toMatchObject({
			name: "Push Day",
			comment: "Good session",
			endedAt: "2026-01-01T11:02:03.000Z",
			sourceIdentifier: "2026-01-01 10:00:00:Push Day",
		});
		expect(result.items[0]?.exercises).toEqual([
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

		const result = adaptStrongAppCsv(csv, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.items[0]?.exercises).toEqual([
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

	it("keeps same-timestamp workouts separate by workout name", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance (m),Seconds,Notes,Workout Notes",
			"2026-01-01 10:00:00,Morning,60,Push Up,1,,10,,,,",
			"2026-01-01 10:00:00,Evening,60,Squat,1,,12,,,,",
		].join("\n");

		const result = adaptStrongAppCsv(csv, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.items.map((item) => item.name)).toEqual(["Morning", "Evening"]);
		expect(result.items.map((item) => item.sourceIdentifier)).toEqual([
			"2026-01-01 10:00:00:Morning",
			"2026-01-01 10:00:00:Evening",
		]);
	});

	it("reports actionable row failures for nonempty unlabelled measurements", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Distance,Reps,Seconds",
			"2026-01-01 10:00:00,Unlabelled,60,Bench Press,1,100,,5,,",
			"2026-01-01 10:00:00,Unlabelled,60,Run,1,,1000,,60",
		].join("\n");

		const result = adaptStrongAppCsv(csv, "Etc/GMT");

		expect(result.items).toEqual([]);
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

		const result = adaptStrongAppCsv(csv, "Etc/GMT");

		expect(result.items).toEqual([]);
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
