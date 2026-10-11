import { Schema } from "@ryot-app/plugin-kit/effect";
import { sandboxContextError, SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { assert, expect, it } from "vitest";

import { encodeWorkoutEditorDraft, WorkoutEditorDraftSchema } from "./workout-editor-draft";
import { WorkoutEditorSaveInputSchema } from "./workout-editor-operations";
import { encodeWorkoutEditorBaseline, WorkoutEditorBaselineSchema } from "./workout-editor-recipes";
import {
	buildWorkoutEditorSaveInput,
	indexWorkoutOccurrences,
} from "./workout-editor-transformations";
import { buildWorkoutSetEventProperties } from "./workout-set";

const KiB = 1024;
const draftLimitBytes = 64 * KiB;
const timestamp = "2026-10-15T10:00:00.000Z";
const note = "筋力トレーニング💪".repeat(12);

const draftSet = (clientId: string, index: number, rich: boolean) => ({
	clientId,
	reps: "12",
	included: true,
	weight: "100.5",
	setLot: "normal",
	distance: undefined,
	duration: undefined,
	occurredAt: timestamp,
	confirmedAt: undefined,
	eventId: `event-${index}`,
	rpe: rich ? "8" : undefined,
	note: rich ? note : undefined,
	restTimerStartedAt: undefined,
	exerciseKind: "reps_and_weight",
	restChoice: { kind: "inherited" },
	videos: rich && index % 5 === 0 ? [{ type: "s3", key: `media/workout/${index}/video.mp4` }] : [],
	images:
		rich && index % 5 === 0
			? [
					{ type: "s3", key: `media/workout/${index}/image-1.jpg` },
					{ type: "local", key: `media/workout/${index}/image-2.jpg` },
				]
			: [],
});

const occurrence = (clientId: string, index: number, setCount: number, rich = true) => ({
	clientId,
	isCollapsed: false,
	notes: rich ? [note] : [],
	sourceExerciseOrder: index,
	exerciseKind: "reps_and_weight",
	exerciseId: `exercise-${index % 3}`,
	images: rich ? [{ type: "s3", key: `media/exercise/${index}/image.jpg` }] : [],
	videos: rich ? [{ type: "local", key: `media/exercise/${index}/video.mp4` }] : [],
	sets: Array.from({ length: setCount }, (_, setIndex) =>
		draftSet(`${clientId}-set-${setIndex}`, index * 100 + setIndex, rich),
	),
	display: rich
		? {
				weightUnit: index % 2 === 0 ? "kg" : "lb",
				distanceUnit: index % 2 === 0 ? "km" : "mi",
				durationUnit: index % 2 === 0 ? "seconds" : "minutes",
			}
		: undefined,
});

const workoutDraft = (occurrences: ReturnType<typeof occurrence>[], rich = true) =>
	Schema.decodeUnknownSync(WorkoutEditorDraftSchema)({
		occurrences,
		activeDuration: 3600,
		startedAt: timestamp,
		displayEnergyUnit: "kcal",
		draftId: "capacity-workout",
		kind: "fitness-workout-editor",
		comment: rich ? note : undefined,
		activeDurationIntent: "preserve",
		name: "Synthetic large workout 💪",
		endedAt: "2026-10-15T11:00:00.000Z",
		caloriesBurnt: rich ? "250" : undefined,
		mode: { kind: "historical", entityId: "workout-existing", conflictToken: "conflict-token" },
		videos: rich
			? Array.from({ length: 12 }, (_, index) => ({
					type: "s3",
					key: `media/workout/video-${index}-${"v".repeat(90)}.mp4`,
				}))
			: [],
		images: rich
			? Array.from({ length: 20 }, (_, index) => ({
					type: index % 2 === 0 ? "s3" : "local",
					key: `media/workout/image-${index}-${"x".repeat(96)}.jpg`,
				}))
			: [],
		supersets:
			occurrences.length < 3
				? []
				: [
						{
							color: "violet",
							clientId: "superset-a",
							occurrenceIds: occurrences.slice(0, 3).map(({ clientId }) => clientId),
						},
					],
	});

const templateDraft = () =>
	Schema.decodeUnknownSync(WorkoutEditorDraftSchema)({
		images: [],
		videos: [],
		supersets: [],
		displayEnergyUnit: "kcal",
		name: "Synthetic template",
		draftId: "capacity-template",
		kind: "fitness-workout-editor",
		activeDurationIntent: "preserve",
		mode: { kind: "template-create" },
		occurrences: Array.from({ length: 22 }, (_occurrenceIndex, occurrenceIndex) => {
			const occurrenceId = `template-occurrence-${occurrenceIndex}`;
			return {
				notes: [note],
				isCollapsed: false,
				clientId: occurrenceId,
				exerciseKind: "reps_and_weight",
				exerciseId: `exercise-${occurrenceIndex % 3}`,
				images: [{ type: "s3", key: `media/exercise/${occurrenceIndex}/image.jpg` }],
				videos: [{ type: "local", key: `media/exercise/${occurrenceIndex}/video.mp4` }],
				sets: Array.from({ length: 3 }, (_setIndex, setIndex) => ({
					images: [],
					videos: [],
					included: false,
					setLot: "normal",
					exerciseKind: "reps_and_weight",
					note: setIndex === 0 ? note : undefined,
					reps: setIndex === 1 ? undefined : "12",
					clientId: `${occurrenceId}-set-${setIndex}`,
					weight: setIndex === 1 ? "100.5" : undefined,
					restChoice:
						setIndex === 2
							? { seconds: "0", kind: "explicit" as const }
							: { kind: "inherited" as const },
				})),
			};
		}),
	});

const saveInputFor = (draft: ReturnType<typeof workoutDraft>) => {
	const saved = buildWorkoutEditorSaveInput(
		draft,
		{ submittedAt: timestamp, submissionId: "capacity-submission" },
		{
			unitSystem: "metric",
			exerciseOverridesById: {},
			restSettings: { dropRestTime: 0, warmUpRestTime: 0, failureRestTime: 0, normalRestTime: 60 },
		},
	);
	if (saved.input === undefined) {
		throw new Error(JSON.stringify(saved.issues));
	}
	return saved.input;
};

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const draftBytes = (value: typeof WorkoutEditorDraftSchema.Type) =>
	jsonBytes(encodeWorkoutEditorDraft(value));
const saveBytes = (value: typeof WorkoutEditorSaveInputSchema.Type) =>
	jsonBytes(Schema.encodeSync(Schema.toCodecJson(WorkoutEditorSaveInputSchema))(value));

it("fits observed workout and template shapes, with a 101-set workout draft and pending save", () => {
	const workoutCounts = Array.from({ length: 20 }, (_, index) => {
		if (index === 0) {
			return 13;
		}
		if (index < 10) {
			return 3;
		}
		return 2;
	});
	const representativeWorkout = workoutDraft(
		workoutCounts.map((count, index) => occurrence(`workout-occurrence-${index}`, index, count)),
	);
	const largeWorkout = workoutDraft([occurrence("workout-occurrence-0", 0, 101, false)], false);
	const pendingSave = saveInputFor(largeWorkout);
	const recoveredLargeWorkout = Schema.decodeSync(WorkoutEditorDraftSchema)({
		...largeWorkout,
		submission: pendingSave,
	});
	const representativeSave = saveInputFor(representativeWorkout);
	assert(representativeSave.data.kind === "workout");
	const original = representativeSave.data;
	const baseline = Schema.decodeUnknownSync(WorkoutEditorBaselineSchema)({
		entity: {
			name: original.name,
			updatedAt: timestamp,
			id: "workout-existing",
			properties: {
				startedAt: timestamp,
				images: original.images,
				videos: original.videos,
				exerciseNotes: original.occurrences.map(({ notes }, exerciseOrder) => ({
					notes,
					exerciseOrder,
				})),
			},
		},
		sets: original.occurrences.flatMap((item, exerciseOrder) =>
			item.sets.map((set, setOrder) => ({
				id: set.eventId,
				entityId: item.exerciseId,
				occurredAt: set.occurredAt,
				sessionEntityId: "workout-existing",
				properties: buildWorkoutSetEventProperties({
					...set,
					...set.measurements,
					setOrder,
					exerciseOrder,
				}),
			})),
		),
	});
	const withBaseline = {
		...representativeWorkout,
		mode: {
			kind: "historical" as const,
			entityId: baseline.entity.id,
			conflictToken: encodeWorkoutEditorBaseline(baseline),
		},
	};
	expect(draftBytes(withBaseline)).toBeLessThanOrEqual(draftLimitBytes);
	expect(saveBytes(saveInputFor(withBaseline))).toBeLessThanOrEqual(
		SANDBOX_LIMITS.execution.contextBytes,
	);
	expect(sandboxContextError(saveInputFor(withBaseline))).toBeNull();
	const recoveredRepresentativeWorkout = Schema.decodeSync(WorkoutEditorDraftSchema)({
		...withBaseline,
		submission: saveInputFor(withBaseline),
	});
	const largeTemplate = templateDraft();
	const templateSave = saveInputFor(largeTemplate);
	assert(templateSave.data.kind === "template");
	const templateBaseline = Schema.decodeSync(WorkoutEditorBaselineSchema)({
		sets: [],
		entity: {
			updatedAt: timestamp,
			id: "template-existing",
			name: templateSave.data.name,
			properties: {
				images: [],
				videos: [],
				exercises: templateSave.data.occurrences.map((item, exerciseOrder) => ({
					exerciseOrder,
					notes: item.notes,
					images: item.images,
					videos: item.videos,
					exerciseId: item.exerciseId,
					sets: item.sets.map((set, setOrder) => ({
						...set.measurements,
						...(set.note === undefined ? {} : { note: set.note }),
						...(set.rpe === undefined ? {} : { rpe: set.rpe }),
						...(set.restTime === undefined ? {} : { restTime: set.restTime }),
						setOrder,
						setLot: set.setLot,
					})),
				})),
			},
		},
	});
	const editingTemplate = {
		...largeTemplate,
		mode: {
			kind: "template-edit" as const,
			entityId: templateBaseline.entity.id,
			conflictToken: encodeWorkoutEditorBaseline(templateBaseline),
		},
	};
	expect(draftBytes(editingTemplate)).toBeLessThanOrEqual(draftLimitBytes);
	expect(saveBytes(saveInputFor(editingTemplate))).toBeLessThanOrEqual(
		SANDBOX_LIMITS.execution.contextBytes,
	);

	expect(indexWorkoutOccurrences(representativeWorkout.occurrences)).toHaveLength(20);
	expect(
		representativeWorkout.occurrences.reduce((total, item) => total + item.sets.length, 0),
	).toBe(60);
	expect(Math.max(...representativeWorkout.occurrences.map(({ sets }) => sets.length))).toBe(13);
	expect(largeTemplate.occurrences).toHaveLength(22);
	expect(largeTemplate.occurrences.reduce((total, item) => total + item.sets.length, 0)).toBe(66);
	expect(largeWorkout.occurrences[0]?.sets).toHaveLength(101);

	expect(draftBytes(recoveredRepresentativeWorkout)).toBeLessThanOrEqual(draftLimitBytes);
	expect(draftBytes(largeTemplate)).toBeLessThanOrEqual(draftLimitBytes);
	expect(draftBytes(recoveredLargeWorkout)).toBeLessThanOrEqual(draftLimitBytes);
	expect(saveBytes(pendingSave)).toBeLessThanOrEqual(SANDBOX_LIMITS.execution.contextBytes);
	expect(sandboxContextError(pendingSave)).toBeNull();
	expect(saveBytes(templateSave)).toBeLessThanOrEqual(SANDBOX_LIMITS.execution.contextBytes);
});

it("rejects an oversized save payload without truncating its Unicode content", () => {
	const save = saveInputFor(workoutDraft([occurrence("occurrence-1", 0, 1)]));
	assert(save.data.kind === "workout");
	const longComment = "筋力💪".repeat(20_000);
	const oversized = { ...save, data: { ...save.data, comment: longComment } };

	expect(sandboxContextError(oversized)).toContain(
		`exceeds ${SANDBOX_LIMITS.execution.contextBytes} UTF-8 bytes`,
	);
	expect(oversized.data.comment).toBe(longComment);
});
