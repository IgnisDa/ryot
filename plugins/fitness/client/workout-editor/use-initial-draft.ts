import type { LocalMessage, RyotClient, RyotSchedule } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type Text,
	useLocalMessage,
	useRyot,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import { resolveWorkoutDisplay } from "../../shared/workout-editor-preferences";
import { type FitnessText, useFitnessMessages } from "../messages";
import { changeOccurrenceDisplay, changeWorkoutEnergyUnit } from "./actions";
import type { WorkoutEditorContext } from "./controller-types";
import { WorkoutEditorPrepareError } from "./prepare-error";
import { readEditorExercises } from "./queries";
import type { useWorkoutEditor } from "./use-workout-editor";

export type PrepareDraft = (
	context: WorkoutEditorContext,
) => Effect.Effect<WorkoutEditorDraft, unknown>;

const startInitialDraft = (input: {
	readonly text: FitnessText;
	readonly client: RyotClient;
	readonly prepare: PrepareDraft;
	readonly onStarted: () => void;
	readonly onSettled: () => void;
	readonly schedule: RyotSchedule;
	readonly onPrepared: () => void;
	readonly isActive: () => boolean;
	readonly context: WorkoutEditorContext;
	readonly starting: { current: boolean };
	readonly setMessage: (message: Text) => void;
	readonly local: (message: LocalMessage) => Text;
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
							? input.local(error.reason)
							: input.text("client.prepare.draft-failed"),
					),
			}),
		),
		() => {
			input.starting.current = false;
			input.onSettled();
		},
	);
};

export function useInitialDraft(input: {
	readonly saving: boolean;
	readonly isActive: boolean;
	readonly message: Text | undefined;
	readonly requiresPro: boolean | undefined;
	readonly onStarted: undefined | (() => void);
	readonly setMessage: (message: Text) => void;
	readonly draft: undefined | WorkoutEditorDraft;
	readonly prepareDraft: undefined | PrepareDraft;
	readonly context: undefined | WorkoutEditorContext;
	readonly controller: ReturnType<typeof useWorkoutEditor>["controller"];
	readonly snapshotStatus: ReturnType<typeof useWorkoutEditor>["snapshot"]["status"];
}) {
	const { saving, context, message, isActive, onStarted, controller, setMessage, prepareDraft } =
		input;
	const text = useFitnessMessages();
	const local = useLocalMessage(PLUGIN_PACKAGE_ID);
	const client = useRyot();
	const schedule = useRyotSchedule();
	const starting = useRef(false);
	const active = useRef(isActive);
	const [useExisting, setUseExisting] = useState(false);
	const [startingDraft, setStartingDraft] = useState(false);
	const [requestHandled, setRequestHandled] = useState(false);
	const requestBlocked = input.requiresPro === true && context !== undefined && !context.pro;
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
			text,
			local,
			client,
			context,
			schedule,
			starting,
			controller,
			setMessage,
			prepare: prepareDraft,
			onStarted: finishRequest,
			isActive: () => active.current,
			onSettled: () => setStartingDraft(false),
			onPrepared: () => {
				setUseExisting(true);
				setStartingDraft(true);
			},
		});
	}, [
		client,
		context,
		controller,
		finishRequest,
		isActive,
		local,
		message,
		prepareDraft,
		requestBlocked,
		requestHandled,
		saving,
		schedule,
		setMessage,
		text,
		input.snapshotStatus,
	]);

	return {
		finishRequest,
		requestBlocked,
		requestHandled,
		starting: startingDraft,
		markStarted: () => setUseExisting(true),
		existingGuard:
			input.draft !== undefined &&
			prepareDraft !== undefined &&
			!requestBlocked &&
			!requestHandled &&
			!useExisting,
	};
}
