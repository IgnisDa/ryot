import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { describe, expect, it } from "vitest";

import { WorkoutEditorDraftSchema } from "../../shared/workout-editor-draft";
import { shiftCountdown } from "./session-timers";

const now = Date.parse("2026-10-16T10:00:00.000Z");

const draftWith = (pausedRemainingSeconds?: number) =>
	Schema.decodeSync(WorkoutEditorDraftSchema)({
		images: [],
		videos: [],
		supersets: [],
		occurrences: [],
		name: "Workout",
		draftId: "draft",
		mode: { kind: "live" },
		displayEnergyUnit: "kcal",
		activeDurationIntent: "set",
		kind: "fitness-workout-editor",
		restCountdown: {
			setId: "set",
			clientId: "rest",
			durationSeconds: 60,
			exerciseId: "exercise",
			occurrenceId: "occurrence",
			deadline: "2026-10-16T10:00:20.000Z",
			...(pausedRemainingSeconds === undefined ? {} : { pausedRemainingSeconds }),
		},
	});

describe("shiftCountdown", () => {
	it("moves a running deadline by whole steps and never before now", () => {
		expect(
			shiftCountdown(draftWith(), "restCountdown", "rest", 15, now).restCountdown?.deadline,
		).toBe("2026-10-16T10:00:35.000Z");
		expect(
			shiftCountdown(draftWith(), "restCountdown", "rest", -30, now).restCountdown?.deadline,
		).toBe("2026-10-16T10:00:00.000Z");
	});

	it("shifts paused time without going below zero", () => {
		expect(
			shiftCountdown(draftWith(10), "restCountdown", "rest", -15, now).restCountdown
				?.pausedRemainingSeconds,
		).toBe(0);
		expect(
			shiftCountdown(draftWith(10), "restCountdown", "rest", 15, now).restCountdown
				?.pausedRemainingSeconds,
		).toBe(25);
	});

	it("leaves the draft unchanged for a replaced countdown", () => {
		const draft = draftWith();
		expect(shiftCountdown(draft, "restCountdown", "other", 15, now)).toBe(draft);
		expect(shiftCountdown(draft, "executionCountdown", "rest", 15, now)).toBe(draft);
	});
});
