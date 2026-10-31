import type { RyotClient, RyotSchedule } from "@ryot-app/plugin-client-sdk";
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

export type PrepareDraft = (context: Context) => Effect.Effect<WorkoutEditorDraft, unknown>;

type Context = typeof WorkoutEditorContextOutputSchema.Type;

const startInitialDraft = (input: {
	readonly context: Context;
	readonly client: RyotClient;
	readonly prepare: PrepareDraft;
	readonly onStarted: () => void;
	readonly schedule: RyotSchedule;
	readonly onPrepared: () => void;
	readonly isActive: () => boolean;
	readonly starting: { current: boolean };
	readonly setMessage: (message: string) => void;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
}) => {
	input.starting.current = true;
	input.schedule.run(
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
						error instanceof WorkoutEditorPrepareError
							? error.message
							: "The draft could not be loaded or stored. Retry before leaving this page.",
					),
			}),
		),
		() => {
			input.starting.current = false;
		},
	);
};

export function useInitialDraft(input: {
	readonly saving: boolean;
	readonly isActive: boolean;
	readonly message: string | undefined;
	readonly context: Context | undefined;
	readonly requiresPro: boolean | undefined;
	readonly onStarted: undefined | (() => void);
	readonly setMessage: (message: string) => void;
	readonly draft: undefined | WorkoutEditorDraft;
	readonly prepareDraft: undefined | PrepareDraft;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
	readonly snapshotStatus: ReturnType<typeof useWorkoutEditor>["snapshot"]["status"];
}) {
	const { saving, context, message, isActive, onStarted, controller, setMessage, prepareDraft } =
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
			saving ||
			starting.current
		) {
			return;
		}
		startInitialDraft({
			client,
			context,
			schedule,
			starting,
			controller,
			setMessage,
			prepare: prepareDraft,
			onStarted: finishRequest,
			isActive: () => active.current,
			onPrepared: () => setUseExisting(true),
		});
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
		saving,
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
