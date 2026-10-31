import { assert, expect, it } from "@effect/vitest";
import { deflateSync } from "@ryot-app/plugin-kit/compression";
import { Schema } from "@ryot-app/plugin-kit/effect";
import { Effect } from "effect";

import { decodeWorkoutEditorJson, encodeWorkoutEditorJson } from "./workout-editor-codec";
import {
	decodeWorkoutEditorDraft,
	encodeWorkoutEditorDraft,
	WorkoutEditorDraftSchema,
} from "./workout-editor-draft";

it.effect(
	"recovers editor input and its frozen submission identity without losing Unicode or zero values",
	() =>
		Effect.gen(function* () {
			const draft = yield* Schema.decodeEffect(WorkoutEditorDraftSchema)({
				images: [],
				videos: [],
				name: "筋力💪",
				supersets: [],
				occurrences: [],
				activeDuration: 0,
				draftId: "draft-1",
				endedAt: undefined,
				caloriesBurnt: "0",
				mode: { kind: "live" },
				comment: "\u0000 notes",
				displayEnergyUnit: "kcal",
				activeDurationIntent: "set",
				kind: "fitness-workout-editor",
				submission: {
					submissionId: "submission-1",
					submittedAt: "2026-10-15T10:00:00.000Z",
					data: {
						images: [],
						videos: [],
						name: "筋力💪",
						supersets: [],
						kind: "workout",
						occurrences: [],
						target: { kind: "create" },
						startedAt: "2026-10-15T10:00:00.000Z",
						activeDuration: { seconds: 0, kind: "set" },
					},
				},
			});
			const recovered = decodeWorkoutEditorDraft(
				yield* Effect.fromResult(encodeWorkoutEditorDraft(draft)),
			);
			assert(recovered._tag === "Success");
			expect(recovered.success).toEqual(draft);
		}),
);

it.effect(
	"rejects corrupt and oversized compressed recovery values instead of returning an empty draft",
	() =>
		Effect.gen(function* () {
			expect(decodeWorkoutEditorDraft("not base64")._tag).toBe("Failure");
			expect(
				decodeWorkoutEditorJson(
					yield* Schema.encodeEffect(Schema.Uint8ArrayFromBase64)(new Uint8Array([255, 255])),
				)._tag,
			).toBe("Failure");
			const oversized = "x".repeat(128 * 1024 + 1);
			expect(
				(yield* Effect.flip(Effect.fromResult(encodeWorkoutEditorJson(oversized)))).message,
			).toContain("decoded byte limit");
			const compressed = yield* Schema.encodeEffect(Schema.Uint8ArrayFromBase64)(
				deflateSync(new TextEncoder().encode(oversized)),
			);
			expect(decodeWorkoutEditorJson(compressed)._tag).toBe("Failure");
		}),
);
