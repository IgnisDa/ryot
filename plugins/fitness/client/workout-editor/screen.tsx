import { DateTime, Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	usePluginScreenSurface,
	useRyotViewport,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import {
	ActionDock,
	Badge,
	Button,
	Card,
	Dialog,
	EmptyState,
	Notice,
	RowGroup,
	ScreenBarButton,
	Skeleton,
	type MenuItem,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useCallback, useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import { workoutEditorSaveOperationSlug } from "../../shared/workout-editor-context-operations";
import type {
	WorkoutEditorDraft,
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
import { requiredWorkoutMeasurementsByKind } from "../../shared/workout-set";
import { managedAssetBatch } from "../asset-urls";
import { MeasurementDialogs, useMeasurementLogger } from "../measurements/measurement-logger";
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
import { ExerciseCard, exerciseArtwork, type ExerciseSheet } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { historySetForOccurrence, previousSetIndex } from "./history-model";
import { ExerciseNotesSheet } from "./instructions";
import { WorkoutMediaOverlay } from "./media";
import { removeDraftMedia, type WorkoutMediaTarget } from "./media-state";
import { MenuButton } from "./menu-button";
import {
	BulkDeleteOverlay,
	HistoryOverlay,
	HistoryRequiresPro,
	ReorderOverlay,
	SupersetOverlay,
} from "./overlays";
import { UnitsAndDefaultsSheet } from "./preferences";
import {
	editorExercisesQuery,
	loadEditorSource,
	readEditorExercises,
	readHistorySets,
	readPreviousSets,
} from "./queries";
import {
	DockTimers,
	formatEditorSeconds,
	RailTimers,
	stopwatchSeconds,
	useEditorNow,
} from "./session-timers";
import { missingMeasurements, type InvalidSet } from "./set-grid";
import { EditorStats } from "./summary";
import { occurrenceSegments, SupersetGroup } from "./superset-group";
import {
	pauseStopwatch,
	pauseWorkout,
	resetStopwatch,
	resumeStopwatch,
	resumeWorkout,
	startExecution,
	unconfirmSet,
} from "./timers";
import { useWorkoutEditor } from "./use-workout-editor";
import {
	ConfirmDialog,
	FinishReview,
	WorkoutDetailsSheet,
	WorkoutPreferencesSheet,
} from "./workout-sheets";

type EditorOverlay =
	| "picker"
	| "reorder"
	| "bulk-delete"
	| "supersets"
	| "finish"
	| "discard"
	| "reload"
	| "details"
	| "preferences"
	| { readonly occurrenceId: string; readonly kind: Exclude<ExerciseSheet, "attachments"> };
const clockTime = (iso: string | undefined) =>
	iso === undefined
		? undefined
		: new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const skeleton = (label: string) => (
	<div role="status" aria-label={label} className="grid gap-3">
		<Skeleton className="h-6 w-3/5" />
		{[0, 1].map((index) => (
			<Card key={index} className="grid gap-2.5">
				<div className="flex items-center gap-2.5">
					<Skeleton className="size-10 rounded-md" />
					<div className="grid flex-1 gap-1.5">
						<Skeleton className="h-3.5 w-2/3" />
						<Skeleton className="h-2.5 w-2/5" />
					</div>
				</div>
				<Skeleton className="h-9 pointer-coarse:h-11" />
				<Skeleton className="h-9 pointer-coarse:h-11" />
			</Card>
		))}
	</div>
);
type SavedEntityId = Extract<WorkoutEditorSaveOutput, { readonly kind: "saved" }>["entityId"];
const startInitialDraft = (input: {
	readonly client: ReturnType<typeof useRyot>;
	readonly context: typeof WorkoutEditorContextOutputSchema.Type;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
	readonly schedule: ReturnType<typeof useRyotSchedule>;
	readonly setMessage: (message: string) => void;
	readonly prepare: (
		context: typeof WorkoutEditorContextOutputSchema.Type,
	) => Effect.Effect<WorkoutEditorDraft, unknown>;
	readonly onStarted: () => void;
	readonly onPrepared: () => void;
	readonly isActive: () => boolean;
	readonly starting: { current: boolean };
}) => {
	if (input.starting.current) {
		return undefined;
	}
	input.starting.current = true;
	return input.schedule.run(
		Effect.gen(function* () {
			const source = yield* input.prepare(input.context);
			const loaded = yield* readEditorExercises(input.client, [
				...new Set(source.occurrences.map(({ exerciseId }) => exerciseId)),
			]);
			const initial = changeWorkoutEnergyUnit(
				{
					...source,
					occurrences: source.occurrences.map((occurrence) =>
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
			if (!input.isActive()) {
				return;
			}
			input.onPrepared();
			yield* Effect.gen(function* () {
				if ((yield* input.controller.start(initial)) && input.isActive()) {
					input.onStarted();
				}
			}).pipe(Effect.uninterruptible);
		}).pipe(
			Effect.match({
				onSuccess: () => undefined,
				onFailure: (error) =>
					input.setMessage(
						typeof error === "string"
							? error
							: "The draft could not be loaded or stored. Retry before leaving this page.",
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
	readonly prepareDraft?: (
		context: typeof WorkoutEditorContextOutputSchema.Type,
	) => Effect.Effect<WorkoutEditorDraft, unknown>;
	readonly onStarted?: () => void;
	readonly requiresPro?: boolean;
	readonly onSaved?: (entityId: SavedEntityId) => void;
}) {
	const { onStarted, prepareDraft } = props;
	const client = useRyot();
	const schedule = useRyotSchedule();
	const { compact, safeAreaBottom } = useRyotViewport();
	const { isActive, scrollRootRef } = usePluginScreenSurface();
	const { sounds, snapshot, controller } = useWorkoutEditor(props.target);
	const [overlay, setOverlay] = useState<EditorOverlay>();
	const [mediaTarget, setMediaTarget] = useState<WorkoutMediaTarget>();
	const [message, setMessage] = useState<string>();
	const [saved, setSaved] = useState<SavedEntityId>();
	const [useExisting, setUseExisting] = useState(false);
	const [requestHandled, setRequestHandled] = useState(false);
	const [conflict, setConflict] = useState<{ readonly reloadable: boolean }>();
	const [invalid, setInvalid] = useState<InvalidSet>();
	const starting = useRef(false);
	const active = useRef(isActive);
	useEffect(() => {
		active.current = isActive;
		return () => {
			active.current = false;
		};
	}, [isActive]);
	const editorRoot = useRef<HTMLDivElement>(null);
	const submitting = useRef(false);
	const editorDraft = snapshot.status === "ready" ? snapshot.draft : undefined;
	const {
		log: measurementLog,
		error: measurementError,
		retry: measurementRetry,
		close: measurementClose,
		dialog: measurementDialog,
		trigger: measurementTrigger,
		setTrigger: measurementSetTrigger,
		unavailable: measurementUnavailable,
	} = useMeasurementLogger();
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
	const requestBlocked =
		props.requiresPro === true && context !== undefined && !context.proAvailable;
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
			!isActive ||
			requestBlocked ||
			requestHandled ||
			message !== undefined ||
			snapshot.status !== "empty" ||
			prepareDraft === undefined ||
			context === undefined ||
			saved !== undefined
		) {
			return undefined;
		}
		startInitialDraft({
			client,
			context,
			schedule,
			starting,
			controller,
			setMessage,
			prepare: prepareDraft,
			isActive: () => active.current,
			onPrepared: () => setUseExisting(true),
			onStarted: () => {
				setRequestHandled(true);
				onStarted?.();
			},
		});
		return undefined;
	}, [
		client,
		context,
		controller,
		isActive,
		message,
		prepareDraft,
		onStarted,
		requestHandled,
		requestBlocked,
		saved,
		schedule,
		snapshot.status,
	]);
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
		props.prepareDraft !== undefined &&
		!requestBlocked &&
		!requestHandled &&
		!useExisting;
	const local =
		editorDraft !== undefined && context !== undefined
			? resolveWorkoutLocalPreferences(editorDraft.localPreferences, context.settings)
			: undefined;
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
				setConflict(result.kind === "conflict" ? { reloadable: editable } : undefined);
				setOverlay(undefined);
				let saveError: string | undefined;
				switch (result.kind) {
					case "pro-required":
						saveError = "This change requires Pro. Your data has been retained.";
						break;
					case "conflict":
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
	const copyPrevious = (occurrence: WorkoutEditorOccurrence, set: WorkoutEditorSet) => {
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
										candidate.clientId !== set.clientId
											? candidate
											: Object.assign(
													{},
													candidate,
													Object.fromEntries(
														requiredWorkoutMeasurementsByKind[candidate.exerciseKind].map(
															(field) => [field, previous[field]],
														),
													),
												),
									),
								};
					}),
				);
				setInvalid(undefined);
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
				now: time,
				setId: set.clientId,
				settings: context.settings,
				timerId: crypto.randomUUID(),
				prompt: local.promptForRestTimer,
				occurrenceId: occurrence.clientId,
				overrides: exercise?.overrides ?? {},
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
	const close = () => setOverlay(undefined);
	const currentSetId =
		editorDraft?.mode.kind === "live"
			? editorDraft.occurrences.flatMap(({ sets }) => sets).find(({ included }) => !included)
					?.clientId
			: undefined;
	const exerciseCard = (occurrence: WorkoutEditorOccurrence, grouped: boolean) =>
		editorDraft === undefined || context === undefined ? null : (
			<ExerciseCard
				now={now}
				grouped={grouped}
				onChange={change}
				compact={compact}
				invalid={invalid}
				draft={editorDraft}
				disabled={disabled}
				occurrence={occurrence}
				key={occurrence.clientId}
				pro={context.proAvailable}
				settings={context.settings}
				currentSetId={currentSetId}
				safeAreaBottom={safeAreaBottom}
				onAddedSet={() => feedback("add-set")}
				onPrevious={(set) => copyPrevious(occurrence, set)}
				onConfirm={(set) => confirm(occurrence, set, true)}
				onStartExecution={(set) => confirm(occurrence, set, false)}
				countdownEnabled={local?.startTimerForDurationExercises ?? false}
				exercise={exercises.data?.find(({ id }) => id === occurrence.exerciseId)}
				onDelete={() => change((draft) => removeWorkoutItems(draft, [occurrence.clientId], []))}
				onSetChanged={(setId) =>
					setInvalid((current) => (current?.setId === setId ? undefined : current))
				}
				unavailable={
					exercises.data !== undefined &&
					!exercises.data.some(({ id }) => id === occurrence.exerciseId)
				}
				onSheet={(sheet) =>
					sheet === "attachments"
						? setMediaTarget({ kind: "occurrence", occurrenceId: occurrence.clientId })
						: setOverlay({ kind: sheet, occurrenceId: occurrence.clientId })
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
		);
	const ready = snapshot.status === "ready" && editorDraft !== undefined && context !== undefined;
	const live = editorDraft?.mode.kind === "live";
	const historical = editorDraft?.mode.kind === "historical";
	const locked = disabled || existingGuard;
	const saveBlocked =
		locked ||
		uploading ||
		exercises.isPending ||
		exercises.isError ||
		editorDraft?.occurrences.some((occurrence) => !names.has(occurrence.exerciseId)) === true;
	const workoutAttachments =
		editorDraft === undefined ? 0 : editorDraft.images.length + editorDraft.videos.length;
	const stopwatch = editorDraft === undefined ? 0 : stopwatchSeconds(editorDraft, now);
	const paused =
		live && editorDraft.activeDurationStartedAt === undefined && editorDraft.endedAt === undefined;
	const nextSet = (() => {
		if (!live) {
			return undefined;
		}
		for (const occurrence of editorDraft.occurrences) {
			const index = occurrence.sets.findIndex(({ included }) => !included);
			const set = occurrence.sets[index];
			if (set !== undefined) {
				return {
					number: index + 1,
					setId: set.clientId,
					name: names.get(occurrence.exerciseId) ?? "Exercise",
				};
			}
		}
		return undefined;
	})();
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
	const togglePause = () =>
		change(
			(draft) =>
				(draft.activeDurationStartedAt === undefined
					? resumeWorkout(draft, schedule.now())
					: pauseWorkout(draft, schedule.now())
				).draft,
		);
	const toggleStopwatch = () =>
		change(
			(draft) =>
				(draft.stopwatchStartedAt === undefined
					? resumeStopwatch(draft, schedule.now())
					: pauseStopwatch(draft, schedule.now())
				).draft,
		);
	const discardLabel = live ? "Discard workout" : "Discard changes";
	const finishLabel = live ? "Finish" : "Save";
	const timerProps = {
		now,
		names,
		nextSet,
		onChange: change,
		disabled: locked,
		onSkipRest: skipRest,
		onStartRest: startRest,
		onFinishExecution: finishExecution,
	};
	const workoutMenu: MenuItem[] =
		editorDraft === undefined
			? []
			: [
					{
						key: "details",
						onSelect: () => setOverlay("details"),
						label: template ? "Template details" : "Workout details",
					},
					...(live
						? [
								{
									key: "measurement",
									label: "Log measurement",
									onSelect: measurementLog,
									disabled: locked || measurementUnavailable,
								},
							]
						: []),
					{
						key: "attachments",
						label: `Attachments (${workoutAttachments})`,
						onSelect: () => setMediaTarget({ kind: "workout" }),
					},
					{ key: "reorder", label: "Reorder exercises", onSelect: () => setOverlay("reorder") },
					{ key: "supersets", label: "Supersets", onSelect: () => setOverlay("supersets") },
					{
						key: "bulk-delete",
						label: "Delete exercises or sets",
						onSelect: () => setOverlay("bulk-delete"),
					},
					...(live
						? [
								{
									key: "stopwatch",
									disabled: locked,
									onSelect: toggleStopwatch,
									label: `${editorDraft.stopwatchStartedAt === undefined ? "Start" : "Pause"} stopwatch (${formatEditorSeconds(stopwatch)})`,
								},
								...(stopwatch > 0 && editorDraft.stopwatchStartedAt === undefined
									? [
											{
												disabled: locked,
												key: "reset-stopwatch",
												label: "Reset stopwatch",
												onSelect: () => change((draft) => resetStopwatch(draft).draft),
											},
										]
									: []),
								{
									key: "preferences",
									label: "Workout preferences",
									onSelect: () => setOverlay("preferences"),
								},
							]
						: []),
					{
						key: "discard",
						destructive: true,
						label: discardLabel,
						disabled: disabled || uploading,
						onSelect: () => setOverlay("discard"),
					},
				];
	const alert = <AppIcon size={16} name="circle-alert" />;
	const notices = (
		<>
			{conflict !== undefined && editorDraft !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title="This workout changed elsewhere"
					action={
						disabled || !conflict.reloadable ? undefined : (
							<Button size="sm" variant="secondary" onClick={() => setOverlay("reload")}>
								Reload saved version
							</Button>
						)
					}
				>
					Your draft is kept. Saving won't overwrite the newer version.
				</Notice>
			) : null}
			{message === undefined ? null : (
				<Notice
					icon={alert}
					tone="danger"
					action={
						snapshot.status === "empty" && props.prepareDraft !== undefined ? (
							<Button size="sm" variant="secondary" onClick={() => setMessage(undefined)}>
								Retry requested draft
							</Button>
						) : undefined
					}
				>
					{message}
				</Notice>
			)}
			{snapshot.contextError === undefined ? null : (
				<Notice
					tone="warning"
					title="Fitness settings couldn't refresh"
					icon={<AppIcon size={16} name="refresh-cw" />}
					action={
						<Button size="sm" variant="secondary" onClick={() => run(controller.refreshContext())}>
							Retry settings
						</Button>
					}
				>
					Your entries are unchanged.
				</Notice>
			)}
			{snapshot.status === "recovery-error" ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Your saved draft couldn't be read"
					action={
						<div className="flex flex-wrap gap-1.5">
							<Button size="sm" onClick={() => run(controller.load())}>
								Retry recovery
							</Button>
							<Button size="sm" variant="dangerGhost" onClick={() => setOverlay("discard")}>
								Discard unreadable draft
							</Button>
						</div>
					}
				>
					Nothing has been deleted. Try again, or discard it to start fresh.
				</Notice>
			) : null}
			{snapshot.status === "empty" && saved !== undefined ? (
				<Notice tone="success" icon={<AppIcon size={16} name="circle-check" />}>
					Saved. Personal-best processing may still be pending.
				</Notice>
			) : null}
			{ready && template ? (
				<Notice
					tone="info"
					title="Planning a template"
					icon={<AppIcon size={16} name="layers-3" />}
				>
					Values are optional. Clocks and completion are off until you start a workout from it.
				</Notice>
			) : null}
			{ready && historical ? (
				<Notice
					tone="info"
					title="Editing a saved workout"
					icon={<AppIcon size={16} name="calendar" />}
				>
					{editorDraft.startedAt === undefined
						? ""
						: `${new Date(editorDraft.startedAt).toLocaleDateString()}, ${clockTime(editorDraft.startedAt)}${editorDraft.endedAt === undefined ? "" : `–${clockTime(editorDraft.endedAt)}`}. `}
					Times and active duration stay as recorded. Use Adjust time on the workout page to change
					them.
				</Notice>
			) : null}
			{ready && paused ? (
				<Notice
					tone="warning"
					title="Workout paused"
					icon={<AppIcon size={16} name="pause" />}
					action={
						<Button size="sm" disabled={locked} onClick={togglePause}>
							Resume workout
						</Button>
					}
				>
					Active time is stopped. Timers keep their remaining time.
				</Notice>
			) : null}
			{ready && snapshot.uploading ? (
				<Notice
					tone="info"
					title="Uploading attachment…"
					icon={<AppIcon size={16} name="refresh-cw" />}
				>
					Saving and leaving wait until the upload finishes.
				</Notice>
			) : null}
			{ready && snapshot.uploadError !== undefined ? (
				<Notice icon={alert} tone="danger" title="An attachment couldn't upload">
					Completed uploads stay in your draft. Reopen attachments to retry, or retry draft storage
					if needed.
				</Notice>
			) : null}
			{ready && snapshot.persistenceError !== undefined ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Changes aren't being saved on this device"
					action={
						<Button size="sm" onClick={() => run(controller.flush())}>
							Retry draft storage
						</Button>
					}
				>
					Keep this page open and retry before leaving.
				</Notice>
			) : null}
			{ready && (snapshot.deviceError !== undefined || snapshot.timerError !== undefined) ? (
				<Notice tone="warning" icon={<AppIcon size={16} name="timer" />}>
					Some device alerts are unavailable. The workout deadline is still retained.
				</Notice>
			) : null}
			{ready && Object.values(snapshot.alertStatus).includes("inexact") ? (
				<Notice tone="warning" icon={<AppIcon size={16} name="timer" />}>
					Timer alerts may arrive late on this device. Rest still ends on time here.
				</Notice>
			) : null}
			{ready && editorDraft.submission !== undefined ? (
				<Notice
					tone={saved === undefined ? "info" : "success"}
					title={saved === undefined ? "Saving didn't finish" : "Workout saved"}
					icon={<AppIcon size={16} name={saved === undefined ? "refresh-cw" : "circle-check"} />}
					action={
						<Button size="sm" onClick={save} disabled={snapshot.saving}>
							{saved === undefined ? "Retry save" : "Finish local cleanup"}
						</Button>
					}
				>
					{saved === undefined
						? "This submission is fixed until saving completes. Retrying won't create a duplicate."
						: "Clearing the draft on this device didn't finish."}
				</Notice>
			) : null}
			{ready && exercises.isError ? (
				<Notice
					icon={alert}
					tone="danger"
					title="Exercise details couldn't load"
					action={
						<Button size="sm" variant="secondary" onClick={exercises.refetch}>
							Retry exercises
						</Button>
					}
				>
					Saving is paused until they load.
				</Notice>
			) : null}
			{ready && live && compact && measurementError ? (
				<Notice
					icon={alert}
					tone="warning"
					action={
						<Button size="sm" variant="secondary" onClick={measurementRetry}>
							Try again
						</Button>
					}
				>
					Your measurements couldn't be loaded.
				</Notice>
			) : null}
		</>
	);
	const states = (
		<>
			{snapshot.status === "loading" ? skeleton("Recovering your workout") : null}
			{snapshot.status === "empty" &&
			prepareDraft !== undefined &&
			!requestHandled &&
			message === undefined &&
			!requestBlocked
				? skeleton("Preparing workout editor")
				: null}
			{context === undefined && snapshot.contextError === undefined && snapshot.status !== "loading"
				? skeleton("Loading Fitness settings")
				: null}
			{snapshot.status === "empty" && saved === undefined && props.prepareDraft === undefined ? (
				<EmptyState
					title="No workout in progress"
					icon={<AppIcon size={20} name="dumbbell" />}
					description="Start an empty workout and add exercises as you go, or plan a reusable template."
					action={
						<div className="grid w-72 max-w-full gap-2">
							<Button
								size="lg"
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
								Start empty workout
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
								<AppIcon size={15} name="layers-3" />
								New template
							</Button>
							{context !== undefined && !context.proAvailable ? (
								<p className="text-xs text-text-muted">Templates require Pro.</p>
							) : null}
						</div>
					}
				/>
			) : null}
		</>
	);
	const cards = ready ? (
		<fieldset disabled={locked} className="grid min-w-0 gap-3 border-0 p-0">
			<ManagedAssetProvider
				assets={managedAssetBatch(
					(exercises.data ?? []).map((exercise) => exerciseArtwork(exercise)),
				)}
			>
				{occurrenceSegments(editorDraft).map((segment) =>
					segment.group === undefined ? (
						segment.occurrences.map((occurrence) => exerciseCard(occurrence, false))
					) : (
						<SupersetGroup
							name={segment.group.name}
							color={segment.group.color}
							key={segment.group.clientId}
							count={segment.occurrences.length}
						>
							{segment.occurrences.map((occurrence) => exerciseCard(occurrence, true))}
						</SupersetGroup>
					),
				)}
			</ManagedAssetProvider>
		</fieldset>
	) : null;
	let headerLine = "Tap to add a comment";
	if (live) {
		headerLine = `Started ${clockTime(editorDraft.startedAt) ?? "now"} · tap to add a reflection`;
	} else if (historical) {
		headerLine = "Tap to edit details";
	}
	let eyebrow = "Workout in progress";
	if (template) {
		eyebrow = "Template";
	} else if (historical) {
		eyebrow = "Editing saved workout";
	}
	const screenTitle = editorDraft?.name.trim();
	const title = screenTitle === undefined || screenTitle === "" ? "Workout editor" : screenTitle;
	return (
		<PluginScreenFrame
			title={title}
			hideTitle={ready}
			floatingAction={
				ready && compact ? (
					<ActionDock safeAreaBottom={safeAreaBottom} label={live ? "Timers" : "Editor actions"}>
						{live ? (
							<DockTimers
								{...timerProps}
								draft={editorDraft}
								onAddExercises={() => setOverlay("picker")}
								onJumpToSet={(setId) => scrollToEditorTarget(`set-${setId}`)}
							/>
						) : (
							<div className="flex items-center gap-2">
								<Button disabled={locked} variant="secondary" onClick={() => setOverlay("picker")}>
									<AppIcon size={16} name="plus" />
									Exercise
								</Button>
								<span className="flex-1" />
								<Button disabled={saveBlocked} onClick={() => setOverlay("finish")}>
									{template ? "Save template" : "Save changes"}
								</Button>
							</div>
						)}
					</ActionDock>
				) : undefined
			}
			barActions={
				ready && compact ? (
					<>
						{live ? (
							<ScreenBarButton
								disabled={locked}
								onClick={togglePause}
								className="text-text hover:bg-surface-2"
								label={paused ? "Resume workout" : "Pause workout"}
							>
								<AppIcon size={20} name={paused ? "play" : "pause"} />
							</ScreenBarButton>
						) : null}
						<MenuButton
							items={workoutMenu}
							label="Workout actions"
							renderTrigger={(trigger) => (
								<ScreenBarButton
									{...trigger}
									label="Workout actions"
									className="text-text hover:bg-surface-2"
								>
									<AppIcon size={20} name="more-horizontal" />
								</ScreenBarButton>
							)}
						/>
						<Button
							size="sm"
							className="ml-1"
							disabled={saveBlocked}
							onClick={() => setOverlay("finish")}
						>
							{finishLabel}
						</Button>
					</>
				) : undefined
			}
		>
			{ready && compact ? (
				<div ref={editorRoot} className="grid gap-4 pb-44 font-ui">
					<header className="grid gap-3">
						<h1 className="text-xl leading-[26px] font-semibold text-balance">
							<button
								type="button"
								onClick={() => setOverlay("details")}
								className="text-left [overflow-wrap:anywhere]"
								aria-label={`Edit ${template ? "template" : "workout"} details, ${title}`}
							>
								{title}
							</button>
						</h1>
						<p className="-mt-2.5 text-xs text-text-muted">{headerLine}</p>
						<EditorStats
							compact
							now={now}
							draft={editorDraft}
							imperial={context.settings.unitSystem === "imperial"}
						/>
					</header>
					{notices}
					{cards}
					<Button
						disabled={locked}
						className="w-full"
						variant="secondary"
						onClick={() => setOverlay("picker")}
					>
						<AppIcon size={16} name="plus" />
						Add exercises
					</Button>
					<p className="text-center text-xs text-text-subtle">
						{live ? "Only completed sets are saved." : null}
						{historical ? "Unchecked sets are removed when you save." : null}
						{template ? "Empty set rows are dropped when you save." : null}
					</p>
				</div>
			) : null}
			{ready && !compact ? (
				<div
					ref={editorRoot}
					className="mx-auto grid w-full max-w-[72rem] grid-cols-[minmax(0,1fr)_20rem] items-start gap-7 pb-16 font-ui"
				>
					<div className="grid min-w-0 gap-4">
						<header className="grid gap-3.5">
							<div className="flex items-start gap-3">
								<div className="min-w-0 flex-1">
									<p className="text-[11px] font-semibold tracking-wider text-accent-text uppercase">
										{eyebrow}
									</p>
									<h1 className="mt-1 font-display text-title font-semibold text-balance [overflow-wrap:anywhere]">
										{title}
									</h1>
								</div>
								<Button
									size="sm"
									variant="ghost"
									disabled={locked}
									onClick={() => setOverlay("details")}
								>
									<AppIcon size={14} name="pencil" />
									Details
								</Button>
							</div>
							<EditorStats
								now={now}
								compact={false}
								draft={editorDraft}
								imperial={context.settings.unitSystem === "imperial"}
							/>
						</header>
						{notices}
						<div className="flex flex-wrap gap-1">
							<Button size="sm" disabled={locked} onClick={() => setOverlay("picker")}>
								<AppIcon size={15} name="plus" />
								Add exercises
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={locked}
								onClick={() => setOverlay("reorder")}
							>
								<AppIcon size={15} name="arrow-up-down" />
								Reorder
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={locked}
								onClick={() => setOverlay("supersets")}
							>
								<AppIcon size={15} name="link" />
								Supersets
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={locked}
								aria-label="Delete exercises or sets"
								onClick={() => setOverlay("bulk-delete")}
							>
								<AppIcon size={15} name="trash-2" />
								Delete…
							</Button>
						</div>
						{cards}
					</div>
					<aside aria-label="Session" className="sticky top-5 grid gap-3">
						{live ? (
							<RailTimers
								{...timerProps}
								draft={editorDraft}
								startedAt={clockTime(editorDraft.startedAt)}
							/>
						) : null}
						<RowGroup>
							{live ? (
								<button
									type="button"
									onClick={measurementLog}
									ref={measurementSetTrigger}
									aria-label="Log measurement"
									disabled={locked || measurementUnavailable}
									className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-hover disabled:opacity-50"
								>
									<AppIcon size={17} name="ruler" className="shrink-0 text-text-muted" />
									<span className="flex-1 text-sm font-medium">Log measurement</span>
									<span className="text-xs text-text-muted">
										{measurementError ? "Couldn't load" : "Saves separately"}
									</span>
								</button>
							) : null}
							<button
								type="button"
								aria-label={`Attachments (${workoutAttachments})`}
								onClick={() => setMediaTarget({ kind: "workout" })}
								className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-hover"
							>
								<AppIcon size={17} name="image" className="shrink-0 text-text-muted" />
								<span className="flex-1 text-sm font-medium">Attachments</span>
								<Badge variant="neutral">{workoutAttachments}</Badge>
							</button>
							{live ? (
								<button
									type="button"
									onClick={() => setOverlay("preferences")}
									className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-hover"
								>
									<AppIcon
										size={17}
										name="sliders-horizontal"
										className="shrink-0 text-text-muted"
									/>
									<span className="flex-1 text-sm font-medium">Workout preferences</span>
									<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
								</button>
							) : null}
						</RowGroup>
						{live && measurementError ? (
							<Button size="sm" variant="secondary" onClick={measurementRetry}>
								Retry measurements
							</Button>
						) : null}
						<Button
							size="lg"
							className="w-full"
							disabled={saveBlocked}
							onClick={() => setOverlay("finish")}
						>
							{finishLabel}
						</Button>
						<Button
							size="sm"
							variant="dangerGhost"
							disabled={disabled || uploading}
							onClick={() => setOverlay("discard")}
						>
							{discardLabel}
						</Button>
					</aside>
				</div>
			) : null}
			{ready ? null : (
				<div ref={editorRoot} className="mx-auto grid w-full max-w-3xl gap-4 pb-16 font-ui">
					{notices}
					{states}
				</div>
			)}
			{isActive ? (
				<>
					<MeasurementDialogs
						onClose={measurementClose}
						dialog={measurementDialog}
						trigger={measurementTrigger}
					/>
					{requestBlocked && !requestHandled ? (
						<Dialog
							size="sm"
							title="Templates require Pro"
							closeLabel="Return to editor"
							description="Your current draft hasn't changed."
							onClose={() => {
								setRequestHandled(true);
								onStarted?.();
							}}
							footer={
								<Button
									onClick={() => {
										setRequestHandled(true);
										onStarted?.();
									}}
								>
									{editorDraft === undefined ? "Return to editor" : "Resume draft"}
								</Button>
							}
						/>
					) : null}
					{mediaTarget !== undefined && editorDraft !== undefined && snapshot.status === "ready" ? (
						<WorkoutMediaOverlay
							compact={compact}
							disabled={locked}
							label={mediaLabel}
							draft={editorDraft}
							target={mediaTarget}
							uploading={snapshot.uploading}
							safeAreaBottom={safeAreaBottom}
							onClose={() => setMediaTarget(undefined)}
							onUpload={(kind, file) => controller.uploadMedia(mediaTarget, kind, file)}
							canUpload={mediaTarget.kind !== "workout" || context?.proAvailable === true}
							onRemove={(kind, asset) =>
								change((draft) => removeDraftMedia(draft, mediaTarget, kind, asset))
							}
						/>
					) : null}
					{existingGuard ? (
						<Dialog
							size="sm"
							title="You have a workout in progress"
							closeLabel="Resume workout in progress"
							onClose={() => {
								setRequestHandled(true);
								onStarted?.();
							}}
							footer={
								<>
									<Button
										disabled={disabled}
										variant="dangerGhost"
										onClick={() => run(controller.discard())}
									>
										Discard and start
									</Button>
									<Button
										onClick={() => {
											setRequestHandled(true);
											onStarted?.();
										}}
									>
										Resume workout
									</Button>
								</>
							}
							description={
								<>
									{editorDraft.name} ·{" "}
									{
										editorDraft.occurrences
											.flatMap(({ sets }) => sets)
											.filter(({ included }) => included).length
									}{" "}
									of {editorDraft.occurrences.flatMap(({ sets }) => sets).length} sets done. Resume
									it, or discard it to start the requested workout.
									{disabled ? " Finish the pending save before starting another workout." : ""}
								</>
							}
						/>
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
					{overlay === "details" && editorDraft !== undefined ? (
						<WorkoutDetailsSheet
							onClose={close}
							compact={compact}
							onChange={change}
							disabled={locked}
							draft={editorDraft}
							safeAreaBottom={safeAreaBottom}
						/>
					) : null}
					{overlay === "preferences" && local !== undefined ? (
						<WorkoutPreferencesSheet
							onClose={close}
							compact={compact}
							onChange={change}
							disabled={locked}
							preferences={local}
							safeAreaBottom={safeAreaBottom}
							pro={context?.proAvailable === true}
						/>
					) : null}
					{overlay === "reorder" && editorDraft !== undefined ? (
						<ReorderOverlay
							names={names}
							onClose={close}
							compact={compact}
							onChange={change}
							draft={editorDraft}
							safeAreaBottom={safeAreaBottom}
						/>
					) : null}
					{overlay === "bulk-delete" && editorDraft !== undefined ? (
						<BulkDeleteOverlay
							names={names}
							onClose={close}
							compact={compact}
							onChange={change}
							draft={editorDraft}
							safeAreaBottom={safeAreaBottom}
						/>
					) : null}
					{overlay === "supersets" && editorDraft !== undefined ? (
						<SupersetOverlay
							names={names}
							onClose={close}
							compact={compact}
							onChange={change}
							draft={editorDraft}
							safeAreaBottom={safeAreaBottom}
						/>
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "defaults" &&
					currentExercise !== undefined &&
					currentOccurrence !== undefined ? (
						<UnitsAndDefaultsSheet
							onClose={close}
							compact={compact}
							exercise={currentExercise}
							onSaved={exercises.refetch}
							occurrence={currentOccurrence}
							safeAreaBottom={safeAreaBottom}
							onDisplay={(display) =>
								change((draft) =>
									updateOccurrence(draft, currentOccurrence.clientId, (occurrence) =>
										changeOccurrenceDisplay(occurrence, display),
									),
								)
							}
						/>
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "notes" &&
					currentOccurrence !== undefined ? (
						<ExerciseNotesSheet
							onClose={close}
							compact={compact}
							exercise={currentExercise}
							occurrence={currentOccurrence}
							safeAreaBottom={safeAreaBottom}
							disabled={disabled || existingGuard}
							onNotes={(notes) =>
								change((draft) =>
									updateOccurrence(draft, currentOccurrence.clientId, (occurrence) => ({
										...occurrence,
										notes,
									})),
								)
							}
						/>
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "history" &&
					currentOccurrence !== undefined &&
					context?.proAvailable === true ? (
						<HistoryOverlay
							onClose={close}
							compact={compact}
							onAppend={appendHistory}
							safeAreaBottom={safeAreaBottom}
							beforeStartedAt={editorDraft?.startedAt}
							exerciseId={currentOccurrence.exerciseId}
							exerciseName={currentExercise?.name ?? "Unavailable exercise"}
							excludeWorkoutId={
								editorDraft?.mode.kind === "historical" ? editorDraft.mode.entityId : undefined
							}
						/>
					) : null}
					{typeof overlay === "object" &&
					overlay.kind === "history" &&
					currentOccurrence !== undefined &&
					context?.proAvailable !== true ? (
						<HistoryRequiresPro
							onClose={close}
							compact={compact}
							safeAreaBottom={safeAreaBottom}
							exerciseName={currentExercise?.name ?? "Unavailable exercise"}
						/>
					) : null}
					{overlay === "reload" ? (
						<ConfirmDialog
							onClose={close}
							cancelLabel="Keep draft"
							title="Reload the saved version?"
							confirmLabel="Discard changes and reload"
							description="Your unsaved changes will be discarded. The newer saved record will not be overwritten."
							onConfirm={() =>
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
											setConflict(undefined);
											setMessage(undefined);
											close();
										}
									}),
								)
							}
						/>
					) : null}
					{overlay === "finish" && editorDraft !== undefined ? (
						<FinishReview
							now={now}
							names={names}
							onSave={save}
							onClose={close}
							compact={compact}
							draft={editorDraft}
							safeAreaBottom={safeAreaBottom}
							saving={snapshot.status === "ready" && snapshot.saving}
						/>
					) : null}
					{overlay === "discard" ? (
						<ConfirmDialog
							onClose={close}
							cancelLabel="Keep logging"
							title={editorDraft === undefined || live ? "Discard workout?" : "Discard changes?"}
							description="Everything in this draft is lost. Saved workouts and measurements stay as they are."
							confirmLabel={
								editorDraft === undefined || live ? "Discard workout" : "Discard changes"
							}
							onConfirm={() =>
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
						/>
					) : null}
				</>
			) : null}
		</PluginScreenFrame>
	);
}
