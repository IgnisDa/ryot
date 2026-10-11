import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { resolveWorkoutDisplay } from "../../shared/workout-editor-preferences";
import { changeOccurrenceDisplay, changeWorkoutEnergyUnit } from "./actions";
import { WorkoutEditorPrepareError } from "./prepare-error";
import { readEditorExercises } from "./queries";
import type { useWorkoutEditor } from "./use-workout-editor";

type Context = typeof WorkoutEditorContextOutputSchema.Type;

export type PrepareDraft = (context: Context) => Effect.Effect<WorkoutEditorDraft, unknown>;

export function useInitialDraft(input: {
	readonly isActive: boolean;
	readonly saved: unknown;
	readonly message: string | undefined;
	readonly onStarted: (() => void) | undefined;
	readonly context: Context | undefined;
	readonly requiresPro: boolean | undefined;
	readonly prepareDraft: PrepareDraft | undefined;
	readonly setMessage: (message: string) => void;
	readonly draft: WorkoutEditorDraft | undefined;
	readonly snapshotStatus: ReturnType<typeof useWorkoutEditor>["snapshot"]["status"];
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
}) {
	const { saved, context, message, isActive, onStarted, controller, setMessage, prepareDraft } =
		input;
	const client = useRyot();
	const schedule = useRyotSchedule();
	const starting = useRef(false);
	const active = useRef(isActive);
	const [useExisting, setUseExisting] = useState(false);
	const [requestHandled, setRequestHandled] = useState(false);
	const requestBlocked =
		input.requiresPro === true && context !== undefined && !context.proAvailable;
	const finishRequest = useCallback(() => {
		setRequestHandled(true);
		onStarted?.();
	}, [onStarted]);

	useEffect(() => {
		active.current = isActive;
		return () => {
			active.current = false;
		};
	}, [isActive]);

	useEffect(() => {
		if (
			!isActive ||
			requestBlocked ||
			requestHandled ||
			message !== undefined ||
			input.snapshotStatus !== "empty" ||
			prepareDraft === undefined ||
			context === undefined ||
			saved !== undefined ||
			starting.current
		) {
			return;
		}
		starting.current = true;
		schedule.run(
			Effect.gen(function* () {
				const source = yield* prepareDraft(context);
				const loaded = yield* readEditorExercises(client, [
					...new Set(source.occurrences.map(({ exerciseId }) => exerciseId)),
				]);
				const initial = changeWorkoutEnergyUnit(
					{
						...source,
						occurrences: source.occurrences.map((occurrence) =>
							changeOccurrenceDisplay(
								occurrence,
								resolveWorkoutDisplay({
									unitSystem: context.settings.unitSystem,
									exerciseDurationUnit: loaded.find(({ id }) => id === occurrence.exerciseId)
										?.overrides.defaultDurationUnit,
								}),
							),
						),
					},
					context.settings.energyUnit,
				);
				if (!active.current) {
					return;
				}
				setUseExisting(true);
				yield* Effect.gen(function* () {
					if ((yield* controller.start(initial)) && active.current) {
						finishRequest();
					}
				}).pipe(Effect.uninterruptible);
			}).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (error) =>
						setMessage(
							error instanceof WorkoutEditorPrepareError
								? error.message
								: "The draft could not be loaded or stored. Retry before leaving this page.",
						),
				}),
			),
			() => {
				starting.current = false;
			},
		);
	}, [
		client,
		context,
		controller,
		finishRequest,
		isActive,
		message,
		prepareDraft,
		requestBlocked,
		requestHandled,
		saved,
		schedule,
		setMessage,
		input.snapshotStatus,
	]);

	return {
		finishRequest,
		requestBlocked,
		requestHandled,
		markStarted: () => setUseExisting(true),
		existingGuard:
			input.draft !== undefined &&
			prepareDraft !== undefined &&
			!requestBlocked &&
			!requestHandled &&
			!useExisting,
	};
}
