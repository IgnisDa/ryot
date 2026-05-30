import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils/dayjs";

import { adaptStrongAppCsv } from "./adapter";

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

		const result = adaptStrongAppCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items.length).toBe(1);
		expect(result.items[0]).toMatchObject({
			name: "Push Day",
			comment: "Good session",
			sourceIdentifier: "2026-01-01 10:00:00:Push Day",
			endedAt: dayjs("2026-01-01 10:00:00").add(3723, "second").toISOString(),
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
				sets: [{ setLot: "normal", distance: 5, duration: 30 }],
			},
			{
				name: "Push Up",
				kind: "reps_and_weight",
				sets: [{ setLot: "normal", reps: 12, weight: 1 }],
			},
			{
				name: "Timed Push Up",
				kind: "reps_and_duration",
				sets: [{ setLot: "normal", reps: 10, duration: 1 }],
			},
		]);
	});

	it("keeps same-timestamp workouts separate by workout name", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance (m),Seconds,Notes,Workout Notes",
			"2026-01-01 10:00:00,Morning,60,Push Up,1,,10,,,,",
			"2026-01-01 10:00:00,Evening,60,Squat,1,,12,,,,",
		].join("\n");

		const result = adaptStrongAppCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.items.map((item) => item.name)).toEqual(["Morning", "Evening"]);
		expect(result.items.map((item) => item.sourceIdentifier)).toEqual([
			"2026-01-01 10:00:00:Morning",
			"2026-01-01 10:00:00:Evening",
		]);
	});

	it("records item failures for exercises without meaningful set statistics", () => {
		const csv = [
			"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Distance (m),Seconds,Notes,Workout Notes",
			"2026-01-01 10:00:00,Empty,60,Mystery,1,,,,,,",
		].join("\n");

		const result = adaptStrongAppCsv(csv);

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
