import { DateTime, Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	usePluginScreenSurface,
	useRyotViewport,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyot, useRyotQuery, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, Modal, StatusMessage, TextArea } from "@ryot-app/plugin-ui-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import { workoutEditorSaveOperationSlug } from "../../shared/workout-editor-context-operations";
import type {
	WorkoutEditorDraft,
	WorkoutEditorLocalPreferences,
	WorkoutEditorOccurrence,
	WorkoutEditorSet,
} from "../../shared/workout-editor-draft";
import {
	WorkoutEditorSaveInputSchema,
	WorkoutEditorSaveOutputSchema,
	type WorkoutEditorSaveOutput,
} from "../../shared/workout-editor-operations";
import {
	resolveWorkoutDisplay,
	resolveWorkoutLocalPreferences,
	resolveWorkoutRestTime,
	WorkoutExerciseOverridesSchema,
} from "../../shared/workout-editor-preferences";
import {
	buildWorkoutEditorSaveInput,
	replaceWorkoutOccurrence,
} from "../../shared/workout-editor-transformations";
import type { WorkoutExercisePickerResult } from "../../shared/workout-exercise-recipes";
import {
	workoutHistoryRecipe,
	type WorkoutHistorySetResult,
} from "../../shared/workout-history-recipes";
import { MeasurementLogger } from "../measurements/measurement-logger";
import {
	changeOccurrenceDisplay,
	changeWorkoutEnergyUnit,
	completeWorkoutSet,
	cycleWorkoutSuperset,
	emptyWorkoutDraft,
	finishWorkoutDraft,
	newWorkoutOccurrence,
	removeWorkoutItems,
	resolvePendingRest,
	updateOccurrence,
	updateSet,
} from "./actions";
import { EditorClocks, useEditorNow } from "./clocks";
import { EditorField, editorModalClass } from "./controls";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { historySetForOccurrence, previousSetIndex } from "./history-model";
import { WorkoutMediaOverlay } from "./media";
import { removeDraftMedia, type WorkoutMediaTarget } from "./media-state";
import { BulkDeleteOverlay, HistoryOverlay, ReorderOverlay, SupersetOverlay } from "./overlays";
import { ExerciseDefaultsOverlay } from "./preferences";
import {
	editorExercisesQuery,
	loadEditorSource,
	readEditorExercises,
	readHistorySets,
	readPreviousSets,
} from "./queries";
import { EditorSummary } from "./summary";
import { startExecution, unconfirmSet } from "./timers";
import { useWorkoutEditor } from "./use-workout-editor";

type EditorOverlay =
	| "picker"
	| "reorder"
	| "bulk-delete"
	| "supersets"
	| "finish"
	| "discard"
	| "rpe"
	| "reload"
	| { readonly kind: "history" | "replace" | "defaults"; readonly occurrenceId: string };
type SavedEntityId = Extract<WorkoutEditorSaveOutput, { readonly kind: "saved" }>["entityId"];
const localPreferenceLabels: Record<keyof WorkoutEditorLocalPreferences, string> = {
	muteSounds: "Mute sounds",
	promptForRestTimer: "Prompt before rest (Pro)",
	startTimerForDurationExercises: "Execution countdown for duration sets",
};
const startInitialDraft = (input: {
	readonly client: ReturnType<typeof useRyot>;
	readonly context: typeof WorkoutEditorContextOutputSchema.Type;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
	readonly schedule: ReturnType<typeof useRyotSchedule>;
	readonly setMessage: (message: string) => void;
	readonly source: WorkoutEditorDraft;
	readonly starting: { current: boolean };
}) => {
	if (input.starting.current) {
		return undefined;
	}
	input.starting.current = true;
	return input.schedule.run(
		Effect.gen(function* () {
			const loaded = yield* readEditorExercises(input.client, [
				...new Set(input.source.occurrences.map(({ exerciseId }) => exerciseId)),
			]);
			const initial = changeWorkoutEnergyUnit(
				{
					...input.source,
					occurrences: input.source.occurrences.map((occurrence) =>
						changeOccurrenceDisplay(
							occurrence,
							resolveWorkoutDisplay({
								unitSystem: input.context.settings.unitSystem,
								exerciseDurationUnit: loaded.find(({ id }) => id === occurrence.exerciseId)
									?.overrides.defaultDurationUnit,
							}),
						),
					),
				},
				input.context.settings.energyUnit,
			);
			yield* input.controller.start(initial).pipe(Effect.uninterruptible);
		}).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: () =>
					input.setMessage(
						"The draft could not be loaded or stored. Retry before leaving this page.",
					),
			}),
			Effect.asVoid,
		),
		() => {
			input.starting.current = false;
		},
	);
};

export function WorkoutEditorScreen(props: {
	readonly target: PluginNavigationTarget;
	readonly initialDraft?: WorkoutEditorDraft;
	readonly onSaved?: (entityId: SavedEntityId) => void;
}) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { compact } = useRyotViewport();
	const { isActive, scrollRootRef } = usePluginScreenSurface();
	const { sounds, snapshot, controller } = useWorkoutEditor(props.target);
	const [overlay, setOverlay] = useState<EditorOverlay>();
	const [mediaTarget, setMediaTarget] = useState<WorkoutMediaTarget>();
	const [message, setMessage] = useState<string>();
	const [saved, setSaved] = useState<SavedEntityId>();
	const [useExisting, setUseExisting] = useState(false);
	const [conflict, setConflict] = useState(false);
	const starting = useRef(false);
	const editorRoot = useRef<HTMLDivElement>(null);
	const submitting = useRef(false);
	const editorDraft = snapshot.status === "ready" ? snapshot.draft : undefined;
	const now = useEditorNow(
		isActive && editorDraft?.mode.kind === "live" && editorDraft.endedAt === undefined,
	);
	const exercises = useRyotQuery(
		editorExercisesQuery,
		{
			exerciseIds: [
				...new Set(editorDraft?.occurrences.map(({ exerciseId }) => exerciseId) ?? []),
			].sort(),
		},
		{ refreshOnMutation: false },
	);
	const context = snapshot.context;
	const run = (effect: Effect.Effect<unknown, unknown>) =>
		schedule.run(
			effect.pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: () =>
						setMessage("This action could not be completed. Your draft is retained. Try again."),
				}),
				Effect.asVoid,
			),
			() => undefined,
		);
	useEffect(() => {
		if (
			snapshot.status !== "empty" ||
			props.initialDraft === undefined ||
			context === undefined ||
			saved !== undefined
		) {
			return undefined;
		}
		return startInitialDraft({
			client,
			context,
			schedule,
			starting,
			controller,
			setMessage,
			source: props.initialDraft,
		});
	}, [client, context, controller, props.initialDraft, saved, schedule, snapshot.status]);
	const scrollToEditorTarget = useCallback(
		(targetId: string) => {
			const target = [...(editorRoot.current?.querySelectorAll<HTMLElement>("[id]") ?? [])].find(
				(candidate) => candidate.id === targetId,
			);
			const root = scrollRootRef.current;
			if (target === undefined || root === null) {
				return;
			}
			const bounds = target.getBoundingClientRect();
			const viewport = root.getBoundingClientRect();
			const above = bounds.top - viewport.top - 24;
			const below = bounds.bottom - viewport.bottom + 24;
			if (above < 0 || bounds.height > viewport.height) {
				root.scrollTop = Math.max(0, root.scrollTop + above);
			} else if (below > 0) {
				root.scrollTop += below;
			}
		},
		[scrollRootRef],
	);
	useEffect(() => {
		if (editorDraft?.activeOccurrenceId === undefined || !isActive) {
			return;
		}
		const targetId =
			editorDraft.activeSetId === undefined
				? `occurrence-${editorDraft.activeOccurrenceId}`
				: `set-${editorDraft.activeSetId}`;
		scrollToEditorTarget(targetId);
	}, [editorDraft?.activeOccurrenceId, editorDraft?.activeSetId, isActive, scrollToEditorTarget]);
	const change = (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => {
		setMessage(undefined);
		return controller.change(transform);
	};
	const muted = editorDraft?.localPreferences?.muteSounds ?? context?.settings.muteSounds ?? false;
	const feedback = (sound: "check" | "add-set" | "timer-started") => run(sounds.play(sound, muted));
	const currentOccurrence =
		typeof overlay === "object"
			? editorDraft?.occurrences.find(({ clientId }) => clientId === overlay.occurrenceId)
			: undefined;
	const currentExercise = exercises.data?.find(({ id }) => id === currentOccurrence?.exerciseId);
	const names = new Map(exercises.data?.map(({ id, name }) => [id, name]));
	const mediaExerciseId =
		mediaTarget?.kind === "occurrence"
			? editorDraft?.occurrences.find(({ clientId }) => clientId === mediaTarget.occurrenceId)
					?.exerciseId
			: undefined;
	const disabled =
		snapshot.status !== "ready" || snapshot.saving || editorDraft?.submission !== undefined;
	const uploading = snapshot.status === "ready" && snapshot.uploading;
	const template =
		editorDraft?.mode.kind === "template-create" || editorDraft?.mode.kind === "template-edit";
	let mediaLabel = template ? "template" : "workout";
	if (mediaTarget?.kind === "occurrence") {
		mediaLabel =
			mediaExerciseId === undefined ? "exercise" : (names.get(mediaExerciseId) ?? "exercise");
	}
	const existingGuard =
		editorDraft !== undefined &&
		props.initialDraft !== undefined &&
		editorDraft.draftId !== props.initialDraft.draftId &&
		!useExisting;
	const local =
		editorDraft !== undefined && context !== undefined
			? resolveWorkoutLocalPreferences(editorDraft.localPreferences, context.settings)
			: undefined;
	let modeIntroduction: string | undefined;
	if (template) {
		modeIntroduction =
			"Plan a reusable session. Partial measurements are allowed; clocks and confirmations are off.";
	} else if (editorDraft?.mode.kind === "historical") {
		modeIntroduction =
			"Editing a saved workout. Original timestamps and active duration are preserved.";
	}
	const save = () => {
		if (snapshot.status === "ready" && snapshot.uploading) {
			setMessage("Wait for the attachment upload to finish before saving.");
			return;
		}
		if (submitting.current || context === undefined) {
			return;
		}
		submitting.current = true;
		run(
			Effect.gen(function* () {
				if (saved !== undefined) {
					if (yield* controller.finish()) {
						props.onSaved?.(saved);
					}
					return;
				}
				yield* controller.reconcile();
				const latest = controller.getSnapshot();
				if (latest.status !== "ready") {
					return;
				}
				const saveContext = latest.context ?? context;
				const candidate =
					latest.draft.submission === undefined
						? finishWorkoutDraft(latest.draft, schedule.now())
						: latest.draft;
				const built = buildWorkoutEditorSaveInput(
					candidate,
					{
						submissionId: crypto.randomUUID(),
						submittedAt: DateTime.formatIso(DateTime.makeUnsafe(schedule.now())),
					},
					{
						restSettings: saveContext.settings,
						unitSystem: saveContext.settings.unitSystem,
						exerciseOverridesById: Object.fromEntries(
							(exercises.data ?? []).map((exercise) => [exercise.id, exercise.overrides]),
						),
					},
				);
				if (built.input === undefined) {
					setMessage(
						`Check the workout: ${[...new Set(built.issues.map(({ code }) => code.replaceAll("-", " ")))].join(", ")}.`,
					);
					setOverlay(undefined);
					return;
				}
				const encodedInput = yield* Schema.encodeEffect(
					Schema.fromJsonString(WorkoutEditorSaveInputSchema),
				)(built.input);
				if (new TextEncoder().encode(encodedInput).byteLength > 64 * 1024) {
					setMessage(
						"This workout exceeds the 64 KiB save limit. Shorten notes or remove entries before saving. Nothing was truncated.",
					);
					setOverlay(undefined);
					return;
				}
				controller.change(() => candidate);
				const input = yield* controller.beginSubmission(built.input);
				const payload = yield* Schema.encodeEffect(
					Schema.toCodecJson(WorkoutEditorSaveInputSchema),
				)(input);
				controller.setSaving(true);
				const result = yield* client.operations
					.invoke({
						input: payload,
						refreshOnSuccess: false,
						packageId: PLUGIN_PACKAGE_ID,
						slug: workoutEditorSaveOperationSlug,
						output: WorkoutEditorSaveOutputSchema,
					})
					.pipe(Effect.ensuring(Effect.sync(() => controller.setSaving(false))));
				if (result.kind === "saved") {
					setSaved(result.entityId);
					setMediaTarget(undefined);
					client.mutationCompleted.hint();
					setOverlay(undefined);
					if (yield* controller.finish()) {
						props.onSaved?.(result.entityId);
					}
					return;
				}
				const editable = yield* controller.rejectSubmission(result);
				setConflict(result.kind === "conflict" && editable);
				setOverlay(undefined);
				let saveError: string;
				switch (result.kind) {
					case "pro-required":
						saveError = "This change requires Pro. Your data has been retained.";
						break;
					case "conflict":
						saveError =
							"The saved record changed. Your draft has been retained; do not overwrite the newer record.";
						break;
					case "invalid":
						saveError = `This workout could not be saved: ${result.code.replaceAll("-", " ")}.`;
						break;
					case "incomplete":
						saveError =
							"The save is incomplete. Retry the same submission to finish without duplicates.";
						break;
				}
				setMessage(saveError);
				if (editable) {
					controller.change((draft) =>
						draft.mode.kind === "live"
							? {
									...draft,
									endedAt: undefined,
									activeDurationStartedAt: DateTime.formatIso(DateTime.makeUnsafe(schedule.now())),
								}
							: draft,
					);
				}
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						submitting.current = false;
					}),
				),
			),
		);
	};
	const copyPrevious = (
		occurrence: WorkoutEditorOccurrence,
		set: WorkoutEditorSet,
		field: "reps" | "weight" | "duration" | "distance",
	) => {
		const latest = controller.getSnapshot();
		if (latest.status !== "ready") {
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
					{
						recordedKind: set.exerciseKind,
						exerciseId: occurrence.exerciseId,
						excludeWorkoutId:
							latest.draft.mode.kind === "historical" ? latest.draft.mode.entityId : "",
						beforeStartedAt:
							latest.draft.startedAt ?? DateTime.formatIso(DateTime.makeUnsafe(schedule.now())),
					},
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
						const previous = historySetForOccurrence(row, current, set.clientId);
						return previous === undefined
							? current
							: {
									...current,
									sets: current.sets.map((candidate) =>
										candidate !== set ? candidate : { ...candidate, [field]: previous[field] },
									),
								};
					}),
				);
			}),
		);
	};
	const appendHistory = (rows: WorkoutHistorySetResult["items"]) => {
		if (currentOccurrence === undefined) {
			return;
		}
		change((draft) =>
			updateOccurrence(draft, currentOccurrence.clientId, (occurrence) =>
				occurrence.exerciseId !== currentOccurrence.exerciseId
					? occurrence
					: {
							...occurrence,
							sets: [
								...occurrence.sets,
								...rows.flatMap((row) => {
									const set = historySetForOccurrence(row, occurrence, crypto.randomUUID());
									return set === undefined
										? []
										: [{ ...set, included: draft.mode.kind === "historical" }];
								}),
							],
						},
			),
		);
		setOverlay(undefined);
	};
	const applyExercises = (selected: readonly WorkoutExercisePickerResult["items"][number][]) => {
		if (context === undefined) {
			return;
		}
		if (
			typeof overlay === "object" &&
			overlay.kind === "replace" &&
			currentOccurrence !== undefined
		) {
			const replacement = selected[0];
			if (replacement?.kind === undefined || replacement.kind === null) {
				return;
			}
			const exerciseKind = replacement.kind;
			change((draft) => {
				const result = replaceWorkoutOccurrence(draft, currentOccurrence.clientId, {
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
			return [
				newWorkoutOccurrence({
					kind: exercise.kind,
					id: crypto.randomUUID(),
					exerciseId: exercise.id,
					setId: crypto.randomUUID(),
					settings: context.settings,
					overrides: overrides.success,
				}),
			];
		});
		const initialized = additions.map((occurrence) =>
			Object.assign({}, occurrence, {
				sets: occurrence.sets.map((set) =>
					Object.assign({}, set, { included: editorDraft?.mode.kind === "historical" }),
				),
			}),
		);
		change((draft) => ({ ...draft, occurrences: [...draft.occurrences, ...initialized] }));
		for (const occurrence of initialized) {
			run(
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
							if (
								current.sets !== occurrence.sets ||
								current.exerciseId !== occurrence.exerciseId
							) {
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
												note: context.proAvailable ? set.note : undefined,
											}),
										),
									};
						}),
					);
				}),
			);
		}
	};
	const confirm = (occurrence: WorkoutEditorOccurrence, set: WorkoutEditorSet, manual: boolean) => {
		if (context === undefined || local === undefined) {
			return;
		}
		const exercise = exercises.data?.find(({ id }) => id === occurrence.exerciseId);
		const time = schedule.now();
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
				const rest = resolveWorkoutRestTime({
					lot: set.setLot,
					settings: context.settings,
					overrides: exercise?.overrides ?? {},
					explicitSeconds: set.restChoice.kind === "explicit" ? set.restChoice.seconds : undefined,
				});
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
					setMessage("Enter all required measurements before starting execution.");
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
				now: time,
				setId: set.clientId,
				settings: context.settings,
				timerId: crypto.randomUUID(),
				prompt: local.promptForRestTimer,
				occurrenceId: occurrence.clientId,
				overrides: exercise?.overrides ?? {},
			});
			if (next === draft) {
				setMessage("Enter all required measurements before confirming this set. Zero is allowed.");
			}
			return next;
		});
		if (completed) {
			feedback("check");
		}
	};
	const close = () => setOverlay(undefined);
	const screenTitle = editorDraft?.name.trim();
	return (
		<PluginScreenFrame
			title={screenTitle === undefined || screenTitle === "" ? "Workout editor" : screenTitle}
			floatingAction={
				editorDraft === undefined ? undefined : (
					<Button
						onClick={() => setOverlay("finish")}
						disabled={
							disabled ||
							uploading ||
							exercises.isPending ||
							exercises.isError ||
							editorDraft.occurrences.some((occurrence) => !names.has(occurrence.exerciseId))
						}
					>
						{template || editorDraft.mode.kind === "historical" ? "Save" : "Finish"}
					</Button>
				)
			}
		>
			<div
				ref={editorRoot}
				className={
					compact
						? "flex flex-col gap-4 font-ui"
						: "mx-auto flex w-full max-w-5xl flex-col gap-6 font-ui"
				}
			>
				{message ? <StatusMessage tone="error">{message}</StatusMessage> : null}
				{message && snapshot.status === "empty" && props.initialDraft !== undefined ? (
					<Button
						variant="secondary"
						onClick={() => {
							const source = props.initialDraft;
							if (source === undefined || context === undefined) {
								return;
							}
							startInitialDraft({
								client,
								source,
								context,
								schedule,
								starting,
								controller,
								setMessage,
							});
						}}
					>
						Retry requested draft
					</Button>
				) : null}
				{conflict && !disabled ? (
					<Button variant="secondary" onClick={() => setOverlay("reload")}>
						Reload saved version
					</Button>
				) : null}
				{context === undefined &&
				snapshot.contextError === undefined &&
				snapshot.status !== "loading" ? (
					<StatusMessage tone="pending">Loading Fitness settings…</StatusMessage>
				) : null}
				{snapshot.contextError !== undefined ? (
					<>
						<StatusMessage tone="error">
							Fitness settings could not be refreshed. Your inputs are unchanged.
						</StatusMessage>
						<Button variant="secondary" onClick={() => run(controller.refreshContext())}>
							Retry settings
						</Button>
					</>
				) : null}
				{snapshot.status === "loading" ? (
					<StatusMessage tone="pending">Recovering draft…</StatusMessage>
				) : null}
				{snapshot.status === "recovery-error" ? (
					<>
						<StatusMessage tone="error">
							The stored draft could not be read. Retry recovery, or explicitly discard it to start
							again.
						</StatusMessage>
						<Button onClick={() => run(controller.load())}>Retry recovery</Button>
						<Button variant="secondary" onClick={() => setOverlay("discard")}>
							Discard unreadable draft
						</Button>
					</>
				) : null}
				{snapshot.status === "empty" && saved === undefined ? (
					<>
						<p>No active draft.</p>
						<Button
							disabled={context === undefined}
							onClick={() => {
								if (context !== undefined) {
									run(
										controller.start(
											emptyWorkoutDraft({
												id: crypto.randomUUID(),
												settings: context.settings,
												now: new Date(schedule.now()).toISOString(),
											}),
										),
									);
								}
							}}
						>
							New workout
						</Button>
						<Button
							variant="secondary"
							disabled={!context?.proAvailable}
							onClick={() => {
								if (context !== undefined) {
									run(
										controller.start(
											emptyWorkoutDraft({
												template: true,
												id: crypto.randomUUID(),
												settings: context.settings,
												now: new Date(schedule.now()).toISOString(),
											}),
										),
									);
								}
							}}
						>
							New template (Pro)
						</Button>
					</>
				) : null}
				{snapshot.status === "empty" && saved !== undefined ? (
					<StatusMessage tone="success">
						Saved. Personal-best processing may still be pending.
					</StatusMessage>
				) : null}
				{snapshot.status === "ready" && editorDraft !== undefined && context !== undefined ? (
					<>
						{modeIntroduction !== undefined ? (
							<p className="text-sm text-text-subtle">{modeIntroduction}</p>
						) : null}
						{snapshot.uploading ? (
							<StatusMessage tone="pending">
								Uploading attachment… Wait before saving or leaving.
							</StatusMessage>
						) : null}
						{snapshot.uploadError !== undefined ? (
							<StatusMessage tone="error">
								An attachment could not be uploaded or stored. Your draft is retained. Reopen
								attachments to retry, or retry draft storage if needed.
							</StatusMessage>
						) : null}
						{snapshot.persistenceError !== undefined ? (
							<>
								<StatusMessage tone="error">
									Draft persistence failed. Keep this page open and retry.
								</StatusMessage>
								<Button onClick={() => run(controller.flush())}>Retry draft storage</Button>
							</>
						) : null}
						{snapshot.deviceError !== undefined || snapshot.timerError !== undefined ? (
							<StatusMessage tone="error">
								Some device alerts are unavailable. The workout deadline is still retained.
							</StatusMessage>
						) : null}
						{Object.values(snapshot.alertStatus).includes("inexact") ? (
							<StatusMessage tone="pending">Device alerts may be delayed.</StatusMessage>
						) : null}
						{editorDraft.submission !== undefined ? (
							<>
								<StatusMessage tone="pending">
									This submission is fixed until saving completes. Retrying will not duplicate it.
								</StatusMessage>
								<Button onClick={save} disabled={snapshot.saving}>
									{saved === undefined ? "Retry save" : "Finish local cleanup"}
								</Button>
							</>
						) : null}
						<fieldset
							disabled={disabled || existingGuard}
							className="flex min-w-0 flex-col gap-4 border-0 p-0"
						>
							<EditorField
								label="Name"
								value={editorDraft.name}
								onChange={(name) => change((draft) => ({ ...draft, name }))}
							/>
							<label className="flex flex-col gap-1 text-sm">
								{template ? "Template comment" : "Workout reflection"}
								<TextArea
									value={editorDraft.comment ?? ""}
									aria-label={template ? "Template comment" : "Workout reflection"}
									onChange={(event) =>
										change((draft) => ({ ...draft, comment: event.target.value }))
									}
								/>
							</label>
							{template ? null : (
								<div className="flex flex-wrap items-end gap-2">
									<EditorField
										numeric
										value={editorDraft.caloriesBurnt}
										label={`Energy (${editorDraft.displayEnergyUnit})`}
										onChange={(caloriesBurnt) => change((draft) => ({ ...draft, caloriesBurnt }))}
									/>
									<Button
										variant="secondary"
										onClick={() =>
											change((draft) =>
												changeWorkoutEnergyUnit(
													draft,
													draft.displayEnergyUnit === "kcal" ? "kJ" : "kcal",
												),
											)
										}
									>
										Change energy unit
									</Button>
								</div>
							)}
							<EditorSummary
								now={now}
								compact={compact}
								draft={editorDraft}
								imperial={context.settings.unitSystem === "imperial"}
							/>
							<Button variant="secondary" onClick={() => setMediaTarget({ kind: "workout" })}>
								{template ? "Template" : "Workout"} attachments (
								{editorDraft.images.length + editorDraft.videos.length})
							</Button>
							{editorDraft.mode.kind === "live" ? (
								<MeasurementLogger disabled={disabled || existingGuard} />
							) : null}
							<EditorClocks now={now} onChange={change} draft={editorDraft} disabled={disabled} />
							{editorDraft.mode.kind === "live" ? (
								<details>
									<summary className="cursor-pointer">Local workout preferences</summary>
									<div className="flex flex-col gap-2">
										{(
											[
												"muteSounds",
												"promptForRestTimer",
												"startTimerForDurationExercises",
											] as const
										).map((key) => (
											<label key={key} className="flex items-center gap-2">
												<input
													type="checkbox"
													checked={local?.[key] ?? false}
													disabled={
														key === "promptForRestTimer" &&
														!context.proAvailable &&
														!local?.promptForRestTimer
													}
													onChange={(event) =>
														change((draft) => ({
															...draft,
															localPreferences: {
																...draft.localPreferences,
																[key]: event.target.checked,
															},
														}))
													}
												/>
												{localPreferenceLabels[key]}
											</label>
										))}
										<Button
											variant="text"
											onClick={() => change((draft) => ({ ...draft, localPreferences: undefined }))}
										>
											Use Fitness preferences
										</Button>
									</div>
								</details>
							) : null}
							<div className="flex flex-wrap gap-2">
								<Button onClick={() => setOverlay("picker")}>Add exercises</Button>
								<Button variant="secondary" onClick={() => setOverlay("reorder")}>
									Reorder
								</Button>
								<Button variant="secondary" onClick={() => setOverlay("supersets")}>
									Supersets
								</Button>
								<Button variant="secondary" onClick={() => setOverlay("bulk-delete")}>
									Bulk delete
								</Button>
							</div>
							{exercises.isError ? (
								<>
									<StatusMessage tone="error">Exercise details could not be loaded.</StatusMessage>
									<Button onClick={exercises.refetch}>Retry exercises</Button>
								</>
							) : null}
							{editorDraft.occurrences.map((occurrence) => (
								<ExerciseCard
									onChange={change}
									draft={editorDraft}
									disabled={disabled}
									occurrence={occurrence}
									key={occurrence.clientId}
									pro={context.proAvailable}
									settings={context.settings}
									onRpeHelp={() => setOverlay("rpe")}
									onAddedSet={() => feedback("add-set")}
									onConfirm={(set) => confirm(occurrence, set, true)}
									onStartExecution={(set) => confirm(occurrence, set, false)}
									countdownEnabled={local?.startTimerForDurationExercises ?? false}
									onPrevious={(set, field) => copyPrevious(occurrence, set, field)}
									exercise={exercises.data?.find(({ id }) => id === occurrence.exerciseId)}
									onReplace={() =>
										setOverlay({ kind: "replace", occurrenceId: occurrence.clientId })
									}
									onOverrides={() =>
										setOverlay({ kind: "defaults", occurrenceId: occurrence.clientId })
									}
									onDelete={() =>
										change((draft) => removeWorkoutItems(draft, [occurrence.clientId], []))
									}
									onMedia={() =>
										setMediaTarget({ kind: "occurrence", occurrenceId: occurrence.clientId })
									}
									onSkipRest={() =>
										change((draft) =>
											resolvePendingRest(draft, schedule.now(), crypto.randomUUID(), true),
										)
									}
									onStartRest={() => {
										change((draft) =>
											resolvePendingRest(draft, schedule.now(), crypto.randomUUID(), false),
										);
										feedback("timer-started");
									}}
									onHistory={() =>
										context.proAvailable
											? setOverlay({ kind: "history", occurrenceId: occurrence.clientId })
											: setMessage(
													"Inline history requires Pro. Previous values and automatic prefill are still available.",
												)
									}
									onCycle={() => {
										let targetId: string | undefined;
										change((draft) => {
											const target = cycleWorkoutSuperset(draft, occurrence.clientId);
											targetId = target;
											return {
												...draft,
												activeSetId: undefined,
												activeOccurrenceId: target,
												occurrences: draft.occurrences.map((item) =>
													item.clientId === target ? { ...item, isCollapsed: false } : item,
												),
											};
										});
										if (targetId !== undefined) {
											scrollToEditorTarget(`occurrence-${targetId}`);
										}
									}}
								/>
							))}
						</fieldset>
						<Button
							variant="secondary"
							onClick={() => setOverlay("discard")}
							disabled={disabled || snapshot.uploading}
						>
							Cancel and discard
						</Button>
					</>
				) : null}
			</div>
			{isActive ? (
				<>
					{mediaTarget !== undefined && editorDraft !== undefined && snapshot.status === "ready" ? (
						<WorkoutMediaOverlay
							label={mediaLabel}
							draft={editorDraft}
							target={mediaTarget}
							uploading={snapshot.uploading}
							disabled={disabled || existingGuard}
							onClose={() => setMediaTarget(undefined)}
							onUpload={(kind, file) => controller.uploadMedia(mediaTarget, kind, file)}
							canUpload={mediaTarget.kind !== "workout" || context?.proAvailable === true}
							onRemove={(kind, asset) =>
								change((draft) => removeDraftMedia(draft, mediaTarget, kind, asset))
							}
						/>
					) : null}
					{existingGuard ? (
						<Modal
							label="Existing draft"
							className={editorModalClass}
							closeLabel="Resume existing draft"
							onClose={() => setUseExisting(true)}
						>
							<h2>You already have a draft</h2>
							{disabled ? <p>Finish the pending save before starting another action.</p> : null}
							<Button onClick={() => setUseExisting(true)}>Resume draft</Button>
							<Button
								variant="secondary"
								disabled={disabled}
								onClick={() => run(controller.discard())}
							>
								Discard and start requested action
							</Button>
						</Modal>
					) : null}
					{overlay === "picker" ||
					(typeof overlay === "object" &&
						overlay.kind === "replace" &&
						currentOccurrence !== undefined) ? (
						<ExercisePicker
							{...(typeof overlay === "object" && currentOccurrence !== undefined
								? {
										replacement: {
											kind: currentOccurrence.exerciseKind,
											name: currentExercise?.name ?? "exercise",
										},
									}
								: {})}
							onClose={close}
							onApply={applyExercises}
						/>
					) : null}
					{overlay === "reorder" && editorDraft !== undefined ? (
						<ReorderOverlay names={names} onClose={close} onChange={change} draft={editorDraft} />
					) : null}
					{overlay === "bulk-delete" && editorDraft !== undefined ? (
						<BulkDeleteOverlay
							names={names}
							onClose={close}
							onChange={change}
							draft={editorDraft}
						/>
					) : null}
					{overlay === "supersets" && editorDraft !== undefined ? (
						<SupersetOverlay names={names} onClose={close} onChange={change} draft={editorDraft} />
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "defaults" &&
					currentExercise !== undefined ? (
						<ExerciseDefaultsOverlay
							onClose={close}
							exercise={currentExercise}
							onSaved={exercises.refetch}
						/>
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "history" &&
					currentOccurrence !== undefined ? (
						<HistoryOverlay
							onClose={close}
							onAppend={appendHistory}
							beforeStartedAt={editorDraft?.startedAt}
							exerciseId={currentOccurrence.exerciseId}
							excludeWorkoutId={
								editorDraft?.mode.kind === "historical" ? editorDraft.mode.entityId : undefined
							}
						/>
					) : null}
					{overlay === "rpe" ? (
						<Modal
							onClose={close}
							label="RPE instructions"
							closeLabel="Close RPE help"
							className={editorModalClass}
						>
							<h2>Rate of perceived exertion</h2>
							<p>
								RPE is a whole number from 0 (no effort) to 10 (maximum effort). 10 means no more
								repetitions were possible; 9 means about one repetition remained; 8 means about two
								remained. It is optional.
							</p>
							<Button onClick={close}>Close</Button>
						</Modal>
					) : null}
					{overlay === "reload" ? (
						<Modal
							onClose={close}
							closeLabel="Keep draft"
							label="Reload saved version"
							className={editorModalClass}
						>
							<h2>Replace this draft with the saved version?</h2>
							<p>
								Your unsaved changes will be discarded. The newer saved record will not be
								overwritten.
							</p>
							<Button
								onClick={() =>
									run(
										Effect.gen(function* () {
											const current = controller.getSnapshot();
											if (
												current.status !== "ready" ||
												(current.draft.mode.kind !== "historical" &&
													current.draft.mode.kind !== "template-edit")
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
												setUseExisting(true);
												setConflict(false);
												setMessage(undefined);
												close();
											}
										}),
									)
								}
							>
								Discard changes and reload
							</Button>
							<Button onClick={close} variant="secondary">
								Keep draft
							</Button>
						</Modal>
					) : null}
					{overlay === "finish" && editorDraft !== undefined ? (
						<Modal
							onClose={close}
							label="Review save"
							className={editorModalClass}
							closeLabel="Continue editing"
							dismissible={snapshot.status !== "ready" || !snapshot.saving}
						>
							<h2 className="text-xl font-semibold">Review {template ? "template" : "workout"}</h2>
							{!template &&
							editorDraft.occurrences.some(
								(occurrence) =>
									!occurrence.sets.some(({ included }) => included) &&
									(occurrence.images.length > 0 || occurrence.videos.length > 0),
							) ? (
								<p>Attachments on exercises with no included sets will not be saved.</p>
							) : null}
							{template ? (
								<p>
									Exercise-only entries and partially specified plans are retained. Completely empty
									set rows are omitted.
								</p>
							) : (
								<p>
									{editorDraft.occurrences.reduce(
										(count, occurrence) =>
											count + occurrence.sets.filter(({ included }) => included).length,
										0,
									)}{" "}
									{editorDraft.mode.kind === "historical" ? "included" : "confirmed"} sets will be
									saved;{" "}
									{editorDraft.occurrences.reduce(
										(count, occurrence) =>
											count + occurrence.sets.filter(({ included }) => !included).length,
										0,
									)}{" "}
									unconfirmed sets will be omitted.
								</p>
							)}
							<Button onClick={save} disabled={snapshot.status !== "ready" || snapshot.saving}>
								Save {template ? "template" : "workout"}
							</Button>
							<Button
								onClick={close}
								variant="secondary"
								disabled={snapshot.status === "ready" && snapshot.saving}
							>
								Continue editing
							</Button>
						</Modal>
					) : null}
					{overlay === "discard" ? (
						<Modal
							onClose={close}
							label="Discard draft"
							closeLabel="Keep draft"
							className={editorModalClass}
						>
							<h2>Discard this draft?</h2>
							<p>Unsaved workout changes will be lost. Saved records are not deleted.</p>
							<Button
								onClick={() =>
									run(
										controller.discard().pipe(
											Effect.tap((removed) =>
												Effect.sync(() => {
													if (removed) {
														setMediaTarget(undefined);
														close();
													}
												}),
											),
										),
									)
								}
							>
								Discard draft
							</Button>
							<Button onClick={close} variant="secondary">
								Keep editing
							</Button>
						</Modal>
					) : null}
				</>
			) : null}
		</PluginScreenFrame>
	);
}
