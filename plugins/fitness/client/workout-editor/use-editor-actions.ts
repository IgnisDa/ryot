import { Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type {
	WorkoutEditorDraft,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	WorkoutEditorSaveInputSchema,
	type WorkoutEditorSaveOutput,
} from "../../shared/workout-editor-operations";
import {
	resolveWorkoutLocalPreferences,
	WorkoutExerciseOverridesSchema,
} from "../../shared/workout-editor-preferences";
import { fitnessRoute } from "../../shared/workout-editor-routes";
import {
	buildWorkoutEditorSaveInput,
	replaceWorkoutOccurrence,
} from "../../shared/workout-editor-transformations";
import {
	WorkoutExercisePickerFiltersSchema,
	workoutExercisePickerRecipe,
	type WorkoutExercisePickerResult,
} from "../../shared/workout-exercise-recipes";
import {
	workoutHistoryRecipe,
	type WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import {
	completeWorkoutSet,
	finishWorkoutDraft,
	newWorkoutOccurrence,
	resolvePendingRest,
} from "./actions";
import { toIso } from "./clock";
import { resolveSetRestTime, updateOccurrence, updateSet } from "./draft-ops";
import { historySetForOccurrence, previousSetIndex } from "./history-model";
import { previousSetsInput } from "./previous-sets";
import {
	type EditorExercise,
	loadEditorSource,
	readHistorySets,
	readPreviousSets,
} from "./queries";
import type { InvalidSet } from "./set-grid";
import { missingMeasurements, startExecution, unconfirmSet } from "./timers";
import type { useWorkoutEditor } from "./use-workout-editor";

export type SavedEntityId = Extract<
	WorkoutEditorSaveOutput,
	{ readonly kind: "saved" }
>["entityId"];
type Editor = ReturnType<typeof useWorkoutEditor>;

type Context = typeof WorkoutEditorContextOutputSchema.Type;

const saveLimitBytes = 64 * 1024;

const saveFailureMessage = (result: Exclude<WorkoutEditorSaveOutput, { kind: "saved" }>) => {
	let message: string | undefined;
	switch (result.kind) {
		case "invalid":
			message = `This workout could not be saved: ${result.code.replaceAll("-", " ")}.`;
			break;
		case "conflict":
			break;
		case "pro-required":
			message = "This change requires Pro. Your data has been retained.";
			break;
	}
	return message;
};

export function useEditorActions(input: {
	readonly saved: Editor["saved"];
	readonly closeMedia: () => void;
	readonly sounds: Editor["sounds"];
	readonly closeOverlay: () => void;
	readonly context: Context | undefined;
	readonly controller: Editor["controller"];
	readonly draft: undefined | WorkoutEditorDraft;
	readonly pendingAddExerciseId: string | undefined;
	readonly exercises: undefined | readonly EditorExercise[];
	readonly scrollTo: (id: string, contextId?: string) => void;
	readonly onSaved: undefined | ((entityId: SavedEntityId) => void);
}) {
	const { context, exercises, closeMedia, controller, closeOverlay, draft: editorDraft } = input;
	const { saved, scrollTo } = input;
	const client = useRyot();
	const schedule = useRyotSchedule();
	const addedExerciseId = useRef<string | undefined>(undefined);
	const [message, setMessage] = useState<string>();
	const [invalid, setInvalid] = useState<InvalidSet>();
	const [conflict, setConflict] = useState(false);
	const local =
		editorDraft !== undefined && context !== undefined
			? resolveWorkoutLocalPreferences(editorDraft.localPreferences, context.settings)
			: undefined;
	const muted = editorDraft?.localPreferences?.muteSounds ?? context?.settings.muteSounds ?? false;

	const run = (effect: Effect.Effect<unknown, unknown>) =>
		schedule.run(
			effect.pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: () =>
						setMessage("This action could not be completed. Your draft is retained. Try again."),
				}),
			),
			() => undefined,
		);
	const change = (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => {
		setMessage(undefined);
		return controller.change(transform);
	};
	const feedback = (sound: Parameters<Editor["sounds"]["play"]>[0]) =>
		run(input.sounds.play(sound, muted));
	const hapticFeedback = (kind: "impact" | "selection") =>
		run(client.device({ kind, action: "haptic" }).pipe(Effect.ignore));
	const exerciseOf = (occurrence: WorkoutEditorOccurrence) =>
		exercises?.find(({ id }) => id === occurrence.exerciseId);

	const blocked = (text: string) => {
		setMessage(text);
		closeOverlay();
	};
	const acknowledgeSave = useEffectEvent(() => {
		closeMedia();
		closeOverlay();
	});
	useEffect(() => {
		if (saved !== undefined) {
			acknowledgeSave();
		}
	}, [saved]);

	const save = () => {
		const current = controller.getSnapshot();
		if (current.status === "ready" && current.uploading) {
			setMessage("Wait for the attachment upload to finish before saving.");
			return;
		}
		run(
			Effect.gen(function* () {
				const result = yield* controller.save((latest) =>
					Effect.gen(function* () {
						const candidate = finishWorkoutDraft(latest.draft, schedule.now());
						const built = buildWorkoutEditorSaveInput(
							candidate,
							{ submissionId: crypto.randomUUID(), submittedAt: toIso(schedule.now()) },
							{
								restSettings: latest.context.settings,
								unitSystem: latest.context.settings.unitSystem,
								exerciseOverridesById: Object.fromEntries(
									(exercises ?? []).map((exercise) => [exercise.id, exercise.overrides]),
								),
							},
						);
						if (built.input === undefined) {
							blocked(
								`Check the workout: ${[...new Set(built.issues.map(({ code }) => code.replaceAll("-", " ")))].join(", ")}.`,
							);
							return undefined;
						}
						const encodedInput = yield* Schema.encodeEffect(
							Schema.fromJsonString(WorkoutEditorSaveInputSchema),
						)(built.input);
						if (new TextEncoder().encode(encodedInput).byteLength > saveLimitBytes) {
							blocked(
								"This workout exceeds the 64 KiB save limit. Shorten notes or remove entries before saving. Nothing was truncated.",
							);
							return undefined;
						}
						return { draft: candidate, input: built.input };
					}),
				);
				if (result === undefined) {
					return;
				}
				if (result.kind === "saved") {
					input.onSaved?.(result.entityId);
					return;
				}
				setConflict(result.kind === "conflict");
				closeOverlay();
				setMessage(saveFailureMessage(result));
				controller.change((rejected) =>
					rejected.mode.kind === "live"
						? { ...rejected, endedAt: undefined, activeDurationStartedAt: toIso(schedule.now()) }
						: rejected,
				);
			}),
		);
	};

	const copyPrevious = (occurrence: WorkoutEditorOccurrence, set: WorkoutEditorSet) => {
		const latest = controller.getSnapshot();
		if (latest.status !== "ready") {
			return;
		}
		const sourceOccurrence = latest.draft.occurrences.find(
			({ clientId }) => clientId === occurrence.clientId,
		);
		const currentIndex =
			sourceOccurrence?.sets.findIndex(({ clientId }) => clientId === set.clientId) ?? -1;
		const destination =
			sourceOccurrence?.sets[
				currentIndex + (sourceOccurrence.sets[currentIndex]?.included ? 1 : 0)
			];
		if (destination === undefined) {
			setMessage("There is no following set to fill. Add a set first.");
			return;
		}
		const index = previousSetIndex(latest.draft.occurrences, occurrence.clientId, set.clientId);
		if (index < 0) {
			return;
		}
		run(
			Effect.gen(function* () {
				const rows = yield* readPreviousSets(
					client,
					previousSetsInput(latest.draft, occurrence, toIso(schedule.now())),
					index + 1,
				);
				const row = rows[index];
				if (row === undefined) {
					setMessage("No previous value is available for this set.");
					return;
				}
				controller.change((draft) =>
					updateOccurrence(draft, occurrence.clientId, (current) => {
						if (current.exerciseId !== occurrence.exerciseId) {
							return current;
						}
						const previous = historySetForOccurrence(row, current, destination.clientId);
						return previous === undefined
							? current
							: {
									...current,
									sets: current.sets.map((candidate) =>
										candidate.clientId !== destination.clientId
											? candidate
											: {
													...candidate,
													...Object.fromEntries(
														requiredWorkoutMeasurementsByKind[candidate.exerciseKind].map(
															(field) => [field, previous[field]],
														),
													),
												},
									),
								};
					}),
				);
				setInvalid(undefined);
			}),
		);
	};

	const appendHistory = (
		occurrence: WorkoutEditorOccurrence,
		rows: WorkoutHistorySetResult["items"],
	) => {
		let firstSetId: string | undefined;
		const appended = change((draft) =>
			updateOccurrence(draft, occurrence.clientId, (current) => {
				if (current.exerciseId !== occurrence.exerciseId) {
					return current;
				}
				const sets = rows.flatMap((row) => {
					const set = historySetForOccurrence(row, current, crypto.randomUUID());
					return set === undefined ? [] : [{ ...set, included: draft.mode.kind === "historical" }];
				});
				firstSetId = sets[0]?.clientId;
				return sets.length === 0
					? current
					: { ...current, isCollapsed: false, sets: [...current.sets, ...sets] };
			}),
		);
		if (appended) {
			feedback("add-set");
			if (firstSetId !== undefined) {
				scrollTo(`set-${firstSetId}`);
			}
		}
		closeOverlay();
	};

	const prefillFromHistory = (occurrence: WorkoutEditorOccurrence) =>
		Effect.gen(function* () {
			const history = yield* client.data.query(
				workoutHistoryRecipe({
					exerciseId: occurrence.exerciseId,
					beforeStartedAt: editorDraft?.startedAt,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
			);
			const session = history.items[0];
			if (session === undefined) {
				return;
			}
			const rows = yield* readHistorySets(client, session.id, occurrence.exerciseId);
			controller.change((draft) =>
				updateOccurrence(draft, occurrence.clientId, (current) => {
					if (current.sets !== occurrence.sets || current.exerciseId !== occurrence.exerciseId) {
						return current;
					}
					const first = rows.find(({ recordedKind }) => recordedKind === current.exerciseKind);
					const copied = rows
						.filter((row) => first !== undefined && row.exerciseOrder === first.exerciseOrder)
						.flatMap((row) => {
							const set = historySetForOccurrence(row, current, crypto.randomUUID());
							return set === undefined ? [] : [set];
						});
					return copied.length === 0
						? current
						: {
								...current,
								sets: copied.map((set) =>
									Object.assign({}, set, {
										included: draft.mode.kind === "historical",
										note: context?.proAvailable === true ? set.note : undefined,
									}),
								),
							};
				}),
			);
		});

	const applyExercises = (
		selected: readonly WorkoutExercisePickerResult["items"][number][],
		replacing: undefined | WorkoutEditorOccurrence,
	) => {
		if (context === undefined) {
			return;
		}
		if (replacing !== undefined) {
			const replacement = selected[0];
			if (replacement?.kind === undefined || replacement.kind === null) {
				return;
			}
			const exerciseKind = replacement.kind;
			change((draft) => {
				const result = replaceWorkoutOccurrence(draft, replacing.clientId, {
					exerciseKind,
					exerciseId: replacement.id,
				});
				return result.kind === "replaced" ? result.draft : draft;
			});
			return;
		}
		const additions = selected.flatMap((exercise) => {
			if (exercise.kind === null) {
				return [];
			}
			const overrides = Schema.decodeResult(WorkoutExerciseOverridesSchema)(
				exercise.membershipProperties ?? {},
			);
			if (overrides._tag === "Failure") {
				setMessage("Exercise defaults could not be read. Refresh the picker and retry.");
				return [];
			}
			const occurrence = newWorkoutOccurrence({
				kind: exercise.kind,
				id: crypto.randomUUID(),
				exerciseId: exercise.id,
				setId: crypto.randomUUID(),
				settings: context.settings,
				overrides: overrides.success,
			});
			return [
				{
					...occurrence,
					sets: occurrence.sets.map((set) =>
						Object.assign({}, set, { included: editorDraft?.mode.kind === "historical" }),
					),
				},
			];
		});
		const first = additions[0];
		if (
			first !== undefined &&
			change((draft) => ({ ...draft, occurrences: [...draft.occurrences, ...additions] }))
		) {
			feedback("add-set");
			scrollTo(`occurrence-${first.clientId}`);
		}
		for (const occurrence of additions) {
			run(prefillFromHistory(occurrence));
		}
	};

	const addPendingExercise = useEffectEvent((exerciseId: string) =>
		run(
			Effect.gen(function* () {
				const filters = Schema.decodeResult(WorkoutExercisePickerFiltersSchema)({
					exerciseIds: [exerciseId],
				});
				const picked =
					filters._tag === "Failure"
						? undefined
						: yield* client.data.query(
								workoutExercisePickerRecipe({
									...filters.success,
									reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
								}),
							);
				const exercise = picked?.items.find(({ kind }) => kind !== null);
				if (exercise === undefined) {
					setMessage("This exercise is not in your library or has no kind, so it was not added.");
					return;
				}
				applyExercises([exercise], undefined);
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => client.navigation.replace(fitnessRoute("/workout-editor"))),
				),
			),
		),
	);
	const addable =
		context !== undefined && editorDraft?.submission === undefined && editorDraft !== undefined;
	useEffect(() => {
		if (input.pendingAddExerciseId === undefined) {
			addedExerciseId.current = undefined;
			return;
		}
		if (addable && addedExerciseId.current !== input.pendingAddExerciseId) {
			addedExerciseId.current = input.pendingAddExerciseId;
			addPendingExercise(input.pendingAddExerciseId);
		}
	}, [addable, input.pendingAddExerciseId]);

	const confirm = (occurrence: WorkoutEditorOccurrence, set: WorkoutEditorSet, manual: boolean) => {
		if (context === undefined || local === undefined) {
			return;
		}
		const overrides = exerciseOf(occurrence)?.overrides ?? {};
		const time = schedule.now();
		setInvalid(undefined);
		if (set.included) {
			change((draft) => unconfirmSet(draft, occurrence.clientId, set.clientId).draft);
			return;
		}
		const positiveDuration = set.duration !== undefined && Number(set.duration) > 0;
		if (
			!manual &&
			local.startTimerForDurationExercises &&
			positiveDuration &&
			editorDraft?.executionCountdown?.setId !== set.clientId
		) {
			const started = change((draft) => {
				const rest = resolveSetRestTime(set, context.settings, overrides);
				if (rest.kind !== "resolved") {
					setMessage("Enter a valid rest duration.");
					return draft;
				}
				const next = startExecution(
					updateSet(draft, occurrence.clientId, set.clientId, (currentSet) => ({
						...currentSet,
						restChoice: { kind: "explicit", seconds: String(rest.seconds) },
					})),
					occurrence.clientId,
					set.clientId,
					time,
					crypto.randomUUID(),
				);
				if (!next.changed) {
					setInvalid({ setId: set.clientId, fields: missingMeasurements(set) });
					return draft;
				}
				return next.draft;
			});
			if (started) {
				feedback("timer-started");
			}
			return;
		}
		const completed = change((draft) => {
			const next = completeWorkoutSet(draft, {
				overrides,
				now: time,
				setId: set.clientId,
				settings: context.settings,
				timerId: crypto.randomUUID(),
				prompt: local.promptForRestTimer,
				occurrenceId: occurrence.clientId,
			});
			if (next === draft) {
				setInvalid({ setId: set.clientId, fields: missingMeasurements(set) });
			}
			return next;
		});
		if (completed) {
			feedback("check");
		}
	};

	const finishExecution = () => {
		const countdown = editorDraft?.executionCountdown;
		const occurrence = editorDraft?.occurrences.find(
			({ clientId }) => clientId === countdown?.occurrenceId,
		);
		const set = occurrence?.sets.find(({ clientId }) => clientId === countdown?.setId);
		if (occurrence !== undefined && set !== undefined) {
			confirm(occurrence, set, true);
		}
	};
	const startRest = () => {
		change((draft) => resolvePendingRest(draft, schedule.now(), crypto.randomUUID(), false));
		feedback("timer-started");
	};
	const skipRest = () =>
		change((draft) => resolvePendingRest(draft, schedule.now(), crypto.randomUUID(), true));

	const reloadSaved = (onReloaded: () => void) =>
		run(
			Effect.gen(function* () {
				const current = controller.getSnapshot();
				if (
					current.status !== "ready" ||
					(current.draft.mode.kind !== "historical" && current.draft.mode.kind !== "template-edit")
				) {
					return;
				}
				const loaded = yield* loadEditorSource(client, {
					draftId: crypto.randomUUID(),
					entityId: current.draft.mode.entityId,
					kind: current.draft.mode.kind === "historical" ? "workout" : "template",
				});
				if (loaded.kind === "blocked") {
					setMessage(
						"The saved version has an unavailable exercise or invalid data. Your draft has been retained.",
					);
					return;
				}
				if (yield* controller.discard()) {
					yield* controller.start(loaded.draft);
					onReloaded();
					setConflict(false);
					setMessage(undefined);
					closeOverlay();
				}
			}),
		);

	return {
		run,
		save,
		local,
		change,
		confirm,
		message,
		invalid,
		conflict,
		feedback,
		skipRest,
		startRest,
		setInvalid,
		setMessage,
		reloadSaved,
		copyPrevious,
		appendHistory,
		applyExercises,
		hapticFeedback,
		finishExecution,
	};
}
