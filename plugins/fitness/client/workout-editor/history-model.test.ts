import { Schema } from "@ryot-app/plugin-kit/effect";
import { EntityId, EventId } from "@ryot-app/plugin-kit/schema";
import { assert, expect, it } from "vitest";

import { WorkoutEditorOccurrenceSchema } from "../../shared/workout-editor-draft";
import type { WorkoutHistorySetResult } from "../../shared/workout-history-recipes";
import { historySetForOccurrence, previousSetIndex } from "./history-model";

const occurrence = (id: string, exerciseId = "exercise-1") =>
	Schema.decodeUnknownSync(WorkoutEditorOccurrenceSchema)({
		notes: [],
		exerciseId,
		images: [],
		videos: [],
		clientId: id,
		isCollapsed: false,
		exerciseKind: "reps_and_weight",
		display: { weightUnit: "lb", distanceUnit: "mi", durationUnit: "minutes" },
		sets: [0, 1].map((index) => ({
			images: [],
			videos: [],
			included: false,
			setLot: "normal",
			clientId: `${id}-set-${index}`,
			exerciseKind: "reps_and_weight",
			restChoice: { kind: "inherited" },
		})),
	});

it("indexes Previous values across repeated occurrences without counting other exercises", () => {
	const occurrences = [
		occurrence("first"),
		occurrence("other", "exercise-2"),
		occurrence("repeated"),
	];
	expect(previousSetIndex(occurrences, "repeated", "repeated-set-1")).toBe(3);
	expect(previousSetIndex(occurrences, "other", "other-set-0")).toBe(0);
	expect(previousSetIndex(occurrences, "repeated", "deleted")).toBe(-1);
});

it("copies reusable history data into display units without saved identity or completion", () => {
	const row: WorkoutHistorySetResult["items"][number] = {
		rpe: 8,
		reps: 8,
		pace: null,
		weight: 100,
		restTime: 0,
		setOrder: 0,
		oneRm: null,
		volume: 800,
		distance: null,
		duration: null,
		setLot: "drop",
		exerciseOrder: 2,
		note: "Steady form",
		id: EventId.make("old-set"),
		recordedKind: "reps_and_weight",
		occurredAt: "2026-10-16T10:00:00.000Z",
		exerciseId: EntityId.make("exercise-1"),
	};
	const copied = historySetForOccurrence(row, occurrence("current"), "new-set");
	assert(copied !== undefined);
	expect(Number(copied.weight)).toBeCloseTo(220.462262185, 8);
	expect(copied).toMatchObject({
		rpe: "8",
		reps: "8",
		setLot: "drop",
		included: false,
		clientId: "new-set",
		note: "Steady form",
		restChoice: { seconds: "0", kind: "explicit" },
	});
	expect(copied.eventId).toBeUndefined();
	expect(copied.confirmedAt).toBeUndefined();
	expect(copied.occurredAt).toBeUndefined();
	expect(
		historySetForOccurrence(
			{ ...row, recordedKind: "duration" },
			occurrence("current"),
			"other-set",
		),
	).toBeUndefined();
});
