import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	usePluginScreenSurface,
	useRyotViewport,
	type PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ManagedAssetProvider,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { MotionList } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import type { WorkoutEditorOccurrence } from "../../shared/workout-editor-draft";
import { managedAssetBatch } from "../asset-urls";
import { useMeasurementLogger } from "../measurements/measurement-logger";
import {
	cycleWorkoutSuperset,
	emptyWorkoutDraft,
	removeWorkoutItems,
	workoutProgressTarget,
} from "./actions";
import { toIso } from "./clock";
import { focusOccurrence, isTemplateDraft } from "./draft-ops";
import { CompactBarActions, CompactDock, CompactEditor, WideEditor } from "./editor-layouts";
import { EditorNotices } from "./editor-notices";
import { EditorOverlays, type EditorOverlay } from "./editor-overlays";
import { EditorStates } from "./editor-states";
import { ExerciseCard } from "./exercise-card";
import type { WorkoutMediaTarget } from "./media-state";
import { editorExercisesQuery } from "./queries";
import { useEditorScroll } from "./scroll";
import { useEditorNow } from "./session-timers";
import { occurrenceSegments, SupersetGroup } from "./superset-group";
import { resetStopwatch, stopwatchSeconds, toggleStopwatch, toggleWorkoutPause } from "./timers";
import { useEditorActions, type SavedEntityId } from "./use-editor-actions";
import { useInitialDraft, type PrepareDraft } from "./use-initial-draft";
import { useWorkoutEditor } from "./use-workout-editor";
import { workoutMenuItems } from "./workout-menu";

export function WorkoutEditorScreen(props: {
	readonly target: PluginNavigationTarget;
	readonly prepareDraft?: PrepareDraft;
	readonly onStarted?: () => void;
	readonly requiresPro?: boolean;
	readonly onSaved?: (entityId: SavedEntityId) => void;
}) {
	const { prepareDraft } = props;
	const schedule = useRyotSchedule();
	const { compact, safeAreaBottom } = useRyotViewport();
	const { isActive, floatingRoot, scrollRootRef } = usePluginScreenSurface();
	const { sounds, snapshot, controller } = useWorkoutEditor(props.target);
	const [overlay, setOverlay] = useState<EditorOverlay>();
	const [mediaTarget, setMediaTarget] = useState<WorkoutMediaTarget>();
	const editorRoot = useRef<HTMLDivElement>(null);
	const editorDraft = snapshot.status === "ready" ? snapshot.draft : undefined;
	const measurement = useMeasurementLogger();
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
	useEffect(() => {
		if (exercises.data !== undefined) {
			controller.setExerciseNames(exercises.data);
		}
	}, [controller, exercises.data]);
	const close = () => setOverlay(undefined);
	const scrollToEditorTarget = useEditorScroll({
		editorRoot,
		floatingRoot,
		active: isActive,
		scrollRoot: scrollRootRef,
	});
	const actions = useEditorActions({
		sounds,
		context,
		controller,
		draft: editorDraft,
		closeOverlay: close,
		onSaved: props.onSaved,
		exercises: exercises.data,
		scrollTo: scrollToEditorTarget,
		closeMedia: () => setMediaTarget(undefined),
	});
	const { local, saved, change, invalid, message, setInvalid, setMessage } = actions;
	const request = useInitialDraft({
		saved,
		context,
		message,
		isActive,
		controller,
		setMessage,
		prepareDraft,
		draft: editorDraft,
		onStarted: props.onStarted,
		requiresPro: props.requiresPro,
		snapshotStatus: snapshot.status,
	});
	useEffect(() => {
		if (editorDraft?.activeOccurrenceId === undefined || !isActive) {
			return;
		}
		scrollToEditorTarget(
			editorDraft.activeSetId === undefined
				? `occurrence-${editorDraft.activeOccurrenceId}`
				: `set-${editorDraft.activeSetId}`,
			`occurrence-${editorDraft.activeOccurrenceId}`,
		);
	}, [editorDraft?.activeOccurrenceId, editorDraft?.activeSetId, isActive, scrollToEditorTarget]);

	const names = new Map(exercises.data?.map(({ id, name }) => [id, name]));
	const disabled =
		snapshot.status !== "ready" || snapshot.saving || editorDraft?.submission !== undefined;
	const uploading = snapshot.status === "ready" && snapshot.uploading;
	const locked = disabled || request.existingGuard;
	const ready = snapshot.status === "ready" && editorDraft !== undefined && context !== undefined;
	const live = editorDraft?.mode.kind === "live";
	const historical = editorDraft?.mode.kind === "historical";
	const template = editorDraft !== undefined && isTemplateDraft(editorDraft);
	const paused =
		live && editorDraft.activeDurationStartedAt === undefined && editorDraft.endedAt === undefined;
	const saveBlocked =
		locked ||
		uploading ||
		exercises.isPending ||
		exercises.isError ||
		editorDraft?.occurrences.some((occurrence) => !names.has(occurrence.exerciseId)) === true;
	const workoutAttachments =
		editorDraft === undefined ? 0 : editorDraft.images.length + editorDraft.videos.length;
	const stopwatch = editorDraft === undefined ? 0 : stopwatchSeconds(editorDraft, now);
	const progressTarget = editorDraft === undefined ? undefined : workoutProgressTarget(editorDraft);
	const currentSetId = progressTarget?.set.clientId;
	const nextSet =
		progressTarget === undefined
			? undefined
			: {
					setId: progressTarget.set.clientId,
					name: names.get(progressTarget.occurrence.exerciseId) ?? "Exercise",
					number: progressTarget.occurrence.sets.indexOf(progressTarget.set) + 1,
				};

	let mediaLabel = template ? "template" : "workout";
	if (mediaTarget?.kind === "occurrence") {
		const mediaExerciseId = editorDraft?.occurrences.find(
			({ clientId }) => clientId === mediaTarget.occurrenceId,
		)?.exerciseId;
		mediaLabel =
			mediaExerciseId === undefined ? "exercise" : (names.get(mediaExerciseId) ?? "exercise");
	}
	const screenTitle = editorDraft?.name.trim();
	const title = screenTitle === undefined || screenTitle === "" ? "Workout editor" : screenTitle;
	const discardLabel = live ? "Discard workout" : "Discard changes";

	const togglePause = () => change((draft) => toggleWorkoutPause(draft, schedule.now()).draft);
	const toggleStopwatchRunning = () =>
		change((draft) => toggleStopwatch(draft, schedule.now()).draft);
	const openWorkoutMedia = () => setMediaTarget({ kind: "workout" });
	const startEmpty = (asTemplate: boolean) => {
		if (context !== undefined) {
			actions.run(
				controller.start(
					emptyWorkoutDraft({
						template: asTemplate,
						id: crypto.randomUUID(),
						settings: context.settings,
						now: toIso(schedule.now()),
					}),
				),
			);
		}
	};
	const discardDraft = () =>
		actions.run(
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
		);

	const timerProps = {
		now,
		names,
		nextSet,
		onChange: change,
		disabled: locked,
		onSkipRest: actions.skipRest,
		onStartRest: actions.startRest,
		onFinishExecution: actions.finishExecution,
	};
	const exerciseCard = (occurrence: WorkoutEditorOccurrence, grouped: boolean) =>
		editorDraft === undefined || context === undefined ? null : (
			<ExerciseCard
				now={now}
				grouped={grouped}
				onChange={change}
				invalid={invalid}
				draft={editorDraft}
				disabled={disabled}
				occurrence={occurrence}
				key={occurrence.clientId}
				pro={context.proAvailable}
				settings={context.settings}
				currentSetId={currentSetId}
				onDeletedSet={() => actions.feedback("delete-set")}
				onPrevious={(set) => actions.copyPrevious(occurrence, set)}
				onConfirm={(set) => actions.confirm(occurrence, set, true)}
				countdownEnabled={local?.startTimerForDurationExercises ?? false}
				onStartExecution={(set) => actions.confirm(occurrence, set, false)}
				exercise={exercises.data?.find(({ id }) => id === occurrence.exerciseId)}
				onManage={(kind) => setOverlay({ kind, occurrenceId: occurrence.clientId })}
				onAddedSet={(setId) => {
					actions.feedback("add-set");
					scrollToEditorTarget(`set-${setId}`);
				}}
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
				onDelete={() =>
					occurrence.sets.some(({ included }) => included)
						? setOverlay({ kind: "delete-exercise", occurrenceId: occurrence.clientId })
						: change((draft) => removeWorkoutItems(draft, [occurrence.clientId], []))
				}
				onCycle={() => {
					let targetId: string | undefined;
					change((draft) => {
						targetId = cycleWorkoutSuperset(draft, occurrence.clientId);
						return focusOccurrence(draft, targetId);
					});
					if (targetId !== undefined) {
						scrollToEditorTarget(`occurrence-${targetId}`);
					}
				}}
			/>
		);

	const notices = (
		<EditorNotices
			live={live}
			saved={saved}
			paused={paused}
			locked={locked}
			compact={compact}
			message={message}
			template={template}
			disabled={disabled}
			draft={editorDraft}
			snapshot={snapshot}
			exercises={exercises}
			onSave={actions.save}
			onResume={togglePause}
			historical={historical}
			conflict={actions.conflict}
			hasContext={context !== undefined}
			measurementError={measurement.error}
			onReload={() => setOverlay("reload")}
			onDiscard={() => setOverlay("discard")}
			onRetryMeasurements={measurement.retry}
			onRetryRequest={() => setMessage(undefined)}
			retryableRequest={prepareDraft !== undefined}
			onFlush={() => actions.run(controller.flush())}
			onRetryLoad={() => actions.run(controller.load())}
			onRetrySettings={() => actions.run(controller.refreshContext())}
		/>
	);
	const states = (
		<EditorStates
			context={context}
			snapshot={snapshot}
			onStart={startEmpty}
			saved={saved !== undefined}
			requested={prepareDraft !== undefined}
			preparing={
				snapshot.status === "empty" &&
				prepareDraft !== undefined &&
				!request.requestHandled &&
				message === undefined &&
				!request.requestBlocked
			}
		/>
	);
	const cards = ready ? (
		<fieldset disabled={locked} className="grid min-w-0 gap-3 border-0 p-0">
			<ManagedAssetProvider
				assets={managedAssetBatch((exercises.data ?? []).map((exercise) => exercise.images?.[0]))}
			>
				<MotionList className="grid gap-3">
					{occurrenceSegments(editorDraft).map((segment) =>
						segment.group === undefined ? (
							segment.occurrences.map((occurrence) => exerciseCard(occurrence, false))
						) : (
							<SupersetGroup
								name={segment.group.name}
								color={segment.group.color}
								count={segment.occurrences.length}
								key={`${segment.group.clientId}:${segment.occurrences[0]?.clientId}`}
							>
								{segment.occurrences.map((occurrence) => exerciseCard(occurrence, true))}
							</SupersetGroup>
						),
					)}
				</MotionList>
			</ManagedAssetProvider>
		</fieldset>
	) : null;
	const layout = {
		now,
		live,
		title,
		cards,
		locked,
		notices,
		template,
		historical,
		editorRoot,
		onOverlay: setOverlay,
	};
	const finishLabel = live ? "Finish" : "Save";
	return (
		<PluginScreenFrame
			title={title}
			hideTitle={ready}
			floatingAction={
				ready && compact ? (
					<CompactDock
						live={live}
						locked={locked}
						draft={editorDraft}
						template={template}
						onOverlay={setOverlay}
						timerProps={timerProps}
						saveBlocked={saveBlocked}
						safeAreaBottom={safeAreaBottom}
						onJumpToSet={(setId) => {
							change((draft) => focusOccurrence(draft, progressTarget?.occurrence.clientId, setId));
							scrollToEditorTarget(`set-${setId}`);
						}}
					/>
				) : undefined
			}
			barActions={
				ready && compact ? (
					<CompactBarActions
						live={live}
						paused={paused}
						locked={locked}
						onOverlay={setOverlay}
						saveBlocked={saveBlocked}
						finishLabel={finishLabel}
						onTogglePause={togglePause}
						menu={workoutMenuItems({
							live,
							locked,
							template,
							stopwatch,
							discardLabel,
							onOverlay: setOverlay,
							attachments: workoutAttachments,
							onLogMeasurement: measurement.log,
							onOpenWorkoutMedia: openWorkoutMedia,
							discardBlocked: disabled || uploading,
							onToggleStopwatch: toggleStopwatchRunning,
							measurementUnavailable: measurement.unavailable,
							stopwatchRunning: editorDraft.stopwatchStartedAt !== undefined,
							onResetStopwatch: () => change((draft) => resetStopwatch(draft).draft),
						})}
					/>
				) : undefined
			}
		>
			{ready && compact ? (
				<CompactEditor {...layout} context={context} draft={editorDraft} />
			) : null}
			{ready && !compact ? (
				<WideEditor
					{...layout}
					context={context}
					draft={editorDraft}
					timerProps={timerProps}
					measurement={measurement}
					finishLabel={finishLabel}
					saveBlocked={saveBlocked}
					discardLabel={discardLabel}
					onOpenWorkoutMedia={openWorkoutMedia}
					discardBlocked={disabled || uploading}
					workoutAttachments={workoutAttachments}
				/>
			) : null}
			{ready ? null : (
				<div ref={editorRoot} className="mx-auto grid w-full max-w-3xl gap-4 pb-16 font-ui">
					{notices}
					{states}
				</div>
			)}
			{isActive ? (
				<EditorOverlays
					now={now}
					names={names}
					locked={locked}
					onClose={close}
					actions={actions}
					context={context}
					overlay={overlay}
					snapshot={snapshot}
					draft={editorDraft}
					disabled={disabled}
					onSave={actions.save}
					mediaLabel={mediaLabel}
					controller={controller}
					measurement={measurement}
					mediaTarget={mediaTarget}
					exercises={exercises.data}
					onDiscarded={discardDraft}
					scrollTo={scrollToEditorTarget}
					onReloaded={request.markStarted}
					refetchExercises={exercises.refetch}
					existingGuard={request.existingGuard}
					requestBlocked={request.requestBlocked}
					requestHandled={request.requestHandled}
					onFinishRequest={request.finishRequest}
					onCloseMedia={() => setMediaTarget(undefined)}
				/>
			) : null}
		</PluginScreenFrame>
	);
}
