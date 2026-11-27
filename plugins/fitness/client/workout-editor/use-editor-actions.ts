import { isEntitlementRequired } from "@ryot-app/plugin-client-sdk";
import { Effect, Schema, SecureRandom } from "@ryot-app/plugin-client-sdk/effect";
import { createUuid } from "@ryot-app/plugin-client-sdk/plugin";
import {
	type Text,
	useFormatters,
	useRyot,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { Catalog } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
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
	type WorkoutEditorValidationIssue,
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
import { type FitnessText, useFitnessMessages } from "../messages";
import {
	completeWorkoutSet,
	finishWorkoutDraft,
	newWorkoutOccurrence,
	resolvePendingRest,
} from "./actions";
import { toIso } from "./clock";
import type { WorkoutEditorContext } from "./controller-types";
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

const saveLimitBytes = 64 * 1024;

const saveInvalidMessages = {
	"duplicate-id": "client.actions.save-invalid.duplicate-id",
	"invalid-time": "client.actions.save-invalid.invalid-time",
	"invalid-source": "client.actions.save-invalid.invalid-source",
	"media-forbidden": "client.actions.save-invalid.media-forbidden",
	"unrelated-event": "client.actions.save-invalid.unrelated-event",
	"invalid-superset": "client.actions.save-invalid.invalid-superset",
	"missing-exercise": "client.actions.save-invalid.missing-exercise",
	"invalid-measurement": "client.actions.save-invalid.invalid-measurement",
	"missing-measurement": "client.actions.save-invalid.missing-measurement",
	"invalid-exercise-kind": "client.actions.save-invalid.invalid-exercise-kind",
} as const satisfies Record<
	Extract<WorkoutEditorSaveOutput, { readonly kind: "invalid" }>["code"],
	keyof Catalog
>;

const checkIssueMessages = {
	"invalid-rpe": "client.actions.check-issue.invalid-rpe",
	"invalid-rest": "client.actions.check-issue.invalid-rest",
	"missing-name": "client.actions.check-issue.missing-name",
	"duplicate-id": "client.actions.check-issue.duplicate-id",
	"unconfirmed-set": "client.actions.check-issue.unconfirmed-set",
	"invalid-superset": "client.actions.check-issue.invalid-superset",
	"missing-start-time": "client.actions.check-issue.missing-start-time",
	"invalid-measurement": "client.actions.check-issue.invalid-measurement",
	"missing-measurement": "client.actions.check-issue.missing-measurement",
} as const satisfies Record<WorkoutEditorValidationIssue["code"], keyof Catalog>;

const saveFailureMessage = (
	text: FitnessText,
	result: Exclude<WorkoutEditorSaveOutput, { kind: "saved" }>,
) => {
	let message: Text | undefined;
	switch (result.kind) {
		case "invalid":
			message = text(saveInvalidMessages[result.code]);
			break;
		case "conflict":
			break;
	}
	return message;
};

export function useEditorActions(input: {
	readonly saved: Editor["saved"];
	readonly closeMedia: () => void;
	readonly sounds: Editor["sounds"];
	readonly closeOverlay: () => void;
	readonly controller: Editor["controller"];
	readonly draft: undefined | WorkoutEditorDraft;
	readonly pendingAddExerciseId: string | undefined;
	readonly context: undefined | WorkoutEditorContext;
	readonly exercises: undefined | readonly EditorExercise[];
	readonly scrollTo: (id: string, contextId?: string) => void;
	readonly onSaved: undefined | ((entityId: SavedEntityId) => void);
}) {
	const { context, exercises, closeMedia, controller, closeOverlay, draft: editorDraft } = input;
	const { saved, scrollTo } = input;
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const client = useRyot();
	const schedule = useRyotSchedule();
	const addedExerciseId = useRef<string | undefined>(undefined);
	const [message, setMessage] = useState<Text>();
	const [invalid, setInvalid] = useState<InvalidSet>();
	const [conflict, setConflict] = useState(false);
	const local =
		editorDraft !== undefined && context !== undefined
			? resolveWorkoutLocalPreferences(editorDraft.localPreferences, context.settings)
			: undefined;
	const muted = editorDraft?.localPreferences?.muteSounds ?? context?.settings.muteSounds ?? false;

	const run = (effect: Effect.Effect<unknown, unknown, SecureRandom.SecureRandom>) =>
		schedule.run(
			effect.pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: () => setMessage(text("client.actions.failed")),
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

	const blocked = (reason: Text) => {
		setMessage(reason);
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

	const rejectSave = (reason: Text | undefined, conflicted: boolean) => {
		setConflict(conflicted);
		closeOverlay();
		setMessage(reason);
		controller.change((rejected) =>
			rejected.mode.kind === "live"
				? { ...rejected, endedAt: undefined, activeDurationStartedAt: toIso(schedule.now()) }
				: rejected,
		);
	};

	const save = (onSaved = input.onSaved) => {
		const current = controller.getSnapshot();
		if (current.status === "ready" && current.uploading) {
			setMessage(text("client.actions.wait-upload"));
			return;
		}
		run(
			Effect.gen(function* () {
				const submissionId = yield* SecureRandom.SecureRandom.use((random) => random.uuidV4());
				const result = yield* controller.save((latest) =>
					Effect.gen(function* () {
						const candidate = finishWorkoutDraft(latest.draft, schedule.now());
						const built = buildWorkoutEditorSaveInput(
							candidate,
							{ submissionId, submittedAt: toIso(schedule.now()) },
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
								text("client.actions.check-workout", {
									issues: formatters
										.list({ type: "unit", style: "long" })
										.format([
											...new Set(built.issues.map(({ code }) => text(checkIssueMessages[code]))),
										]),
								}),
							);
							return undefined;
						}
						const encodedInput = yield* Schema.encodeEffect(
							Schema.fromJsonString(WorkoutEditorSaveInputSchema),
						)(built.input);
						if (new TextEncoder().encode(encodedInput).byteLength > saveLimitBytes) {
							blocked(text("client.actions.too-large"));
							return undefined;
						}
						return { draft: candidate, input: built.input };
					}),
				);
				if (result === undefined) {
					return;
				}
				if (result.kind === "saved") {
					onSaved?.(result.entityId);
					return;
				}
				rejectSave(saveFailureMessage(text, result), result.kind === "conflict");
			}).pipe(
				Effect.catchIf(isEntitlementRequired, () =>
					Effect.sync(() => rejectSave(text("client.actions.pro"), false)),
				),
			),
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
			setMessage(text("client.actions.no-following-set"));
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
					setMessage(text("client.actions.no-previous"));
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
		const appendedSets: { firstId: string | undefined } = { firstId: undefined };
		const appended = change((draft) =>
			updateOccurrence(draft, occurrence.clientId, (current) => {
				if (current.exerciseId !== occurrence.exerciseId) {
					return current;
				}
				const sets = rows.flatMap((row) => {
					const set = historySetForOccurrence(row, current, createUuid());
					return set === undefined ? [] : [{ ...set, included: draft.mode.kind === "historical" }];
				});
				appendedSets.firstId = sets[0]?.clientId;
				return sets.length === 0
					? current
					: { ...current, isCollapsed: false, sets: [...current.sets, ...sets] };
			}),
		);
		if (appended) {
			feedback("add-set");
			if (appendedSets.firstId !== undefined) {
				scrollTo(`set-${appendedSets.firstId}`);
			}
		}
		closeOverlay();
	};

	const prefillFromHistory = (occurrence: WorkoutEditorOccurrence) =>
		Effect.gen(function* () {
			const history = yield* client.data.query(
				workoutHistoryRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ exerciseId: occurrence.exerciseId, beforeStartedAt: editorDraft?.startedAt },
				{ pages: { workouts: { after: undefined } } },
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
							const set = historySetForOccurrence(row, current, createUuid());
							return set === undefined ? [] : [set];
						});
					return copied.length === 0
						? current
						: {
								...current,
								sets: copied.map((set) =>
									Object.assign({}, set, {
										included: draft.mode.kind === "historical",
										note: context?.pro === true ? set.note : undefined,
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
				setMessage(text("client.actions.defaults-unreadable"));
				return [];
			}
			const occurrence = newWorkoutOccurrence({
				id: createUuid(),
				kind: exercise.kind,
				setId: createUuid(),
				exerciseId: exercise.id,
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
									reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
								}),
								{
									sort: filters.success.sort,
									kinds: filters.success.kinds,
									search: filters.success.search,
									forces: filters.success.forces,
									levels: filters.success.levels,
									targetIds: filters.success.targetIds,
									mechanics: filters.success.mechanics,
									exerciseIds: filters.success.exerciseIds,
									equipmentIds: filters.success.equipmentIds,
									collectionIds: filters.success.collectionIds,
								},
							);
				const exercise = picked?.items.find(({ kind }) => kind !== null);
				if (exercise === undefined) {
					setMessage(text("client.actions.not-added"));
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
					setMessage(text("client.actions.invalid-rest"));
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
					createUuid(),
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
				timerId: createUuid(),
				settings: context.settings,
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
		change((draft) => resolvePendingRest(draft, schedule.now(), createUuid(), false));
		feedback("timer-started");
	};
	const skipRest = () =>
		change((draft) => resolvePendingRest(draft, schedule.now(), createUuid(), true));

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
					entityId: current.draft.mode.entityId,
					kind: current.draft.mode.kind === "historical" ? "workout" : "template",
					draftId: yield* SecureRandom.SecureRandom.use((random) => random.uuidV4()),
				});
				if (loaded.kind === "blocked") {
					setMessage(text("client.actions.reload-blocked"));
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
