import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button, Container, Group, Skeleton, Stack } from "@mantine/core";
import { changeCase, isString, parseParameters } from "@ryot/ts-utils";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { $path } from "safe-routes";
import { useInterval } from "usehooks-ts";
import { z } from "zod";
import { ExerciseDisplay } from "~/components/routes/fitness.action/exercise-display/display";
import { WorkoutHeader } from "~/components/routes/fitness.action/header";
import {
	getProgressOfExercise,
	usePerformTasksAfterSetConfirmed,
	usePlayFitnessSound,
} from "~/components/routes/fitness.action/hooks";
import {
	WorkoutModals,
	useWorkoutModals,
} from "~/components/routes/fitness.action/modals";
import { DEFAULT_SET_TIMEOUT_DELAY_MS } from "~/components/routes/fitness.action/utils";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useUserPreferences } from "~/lib/shared/hooks";
import {
	postMessageToServiceWorker,
	sendNotificationToServiceWorker,
} from "~/lib/shared/service-worker";
import {
	useCurrentWorkout,
	useCurrentWorkoutTimerAtom,
	useMeasurementsDrawerOpen,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { FitnessAction } from "~/lib/types";
import type { Route } from "./+types/_dashboard.fitness.$action";

export const loader = async ({ params }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.nativeEnum(FitnessAction) }),
	);
	return {
		action,
		isUpdatingWorkout: action === FitnessAction.UpdateWorkout,
		isCreatingTemplate: action === FitnessAction.CreateTemplate,
	};
};

export const meta = ({ data }: Route.MetaArgs) => {
	return [{ title: `${changeCase(data?.action || "")} | Ryot` }];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const [parent] = useAutoAnimate();
	const [isSaveBtnLoading, setIsSaveBtnLoading] = useState(false);
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [_, setMeasurementsDrawerOpen] = useMeasurementsDrawerOpen();
	const [currentTimer, setCurrentTimer] = useCurrentWorkoutTimerAtom();
	const {
		assetsModalOpened,
		setAssetsModalOpened,
		timerDrawerOpened,
		openTimerDrawer,
		closeTimerDrawer,
		toggleTimerDrawer,
		isReorderDrawerOpened,
		setIsReorderDrawerOpened,
		openReorderDrawer,
		supersetWithExerciseIdentifier,
		setSupersetModalOpened,
	} = useWorkoutModals();
	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const isWorkoutPaused = isString(currentWorkout?.durations.at(-1)?.to);
	const numberOfExercises = currentWorkout?.exercises.length || 0;
	const shouldDisplayWorkoutTimer = Boolean(
		loaderData.action === FitnessAction.LogWorkout,
	);
	const shouldDisplayReorderButton = Boolean(numberOfExercises > 1);
	const shouldDisplayFinishButton = Boolean(
		loaderData.isCreatingTemplate
			? numberOfExercises > 0
			: currentWorkout?.exercises.some(
					(_e, idx) =>
						getProgressOfExercise(currentWorkout, idx) !== "not-started",
				),
	);
	const shouldDisplayCancelButton = true;

	useInterval(() => {
		if (
			loaderData.action === FitnessAction.LogWorkout &&
			navigator.serviceWorker.controller &&
			document.visibilityState === "visible"
		)
			postMessageToServiceWorker({
				event: "remove-timer-completed-notification",
			});
	}, 5000);
	useInterval(() => {
		const timeRemaining = dayjsLib(currentTimer?.willEndAt).diff(
			dayjsLib(),
			"second",
		);
		if (!currentTimer?.wasPausedAt && timeRemaining && timeRemaining <= 3) {
			if (navigator.vibrate) navigator.vibrate(200);
			if (timeRemaining <= 1) {
				const triggeredBy = currentTimer?.triggeredBy;
				if (promptForRestTimer && triggeredBy && currentWorkout) {
					const exerciseIdx = currentWorkout?.exercises.findIndex(
						(c) => c.identifier === triggeredBy.exerciseIdentifier,
					);
					const setIdx = currentWorkout?.exercises[exerciseIdx]?.sets.findIndex(
						(s) => s.identifier === triggeredBy.setIdentifier,
					);
					if (
						exerciseIdx !== -1 &&
						exerciseIdx !== undefined &&
						userPreferences.fitness.logging.promptForRestTimer
					) {
						performTasksAfterSetConfirmed(setIdx, exerciseIdx);
					}
				}
				playCompleteTimerSound();
				stopTimer();
				setTimeout(() => closeTimerDrawer(), DEFAULT_SET_TIMEOUT_DELAY_MS);
			}
		}
	}, 1000);

	const timerCompleteSound = usePlayFitnessSound("/timer-completed.mp3");

	const playCompleteTimerSound = () => {
		timerCompleteSound();
		if (document.visibilityState === "visible") return;
		sendNotificationToServiceWorker({
			title: "Timer completed",
			body: "Let's get this done!",
			tag: "timer-completed",
			data: { event: "open-link", link: window.location.href },
		});
	};
	const startTimer = (
		duration: number,
		triggeredBy?: { exerciseIdentifier: string; setIdentifier: string },
	) => {
		setCurrentTimer({
			triggeredBy,
			totalTime: duration,
			willEndAt: dayjsLib().add(duration, "second").toISOString(),
		});
	};
	const pauseOrResumeTimer = () => {
		if (currentTimer)
			setCurrentTimer(
				produce(currentTimer, (draft) => {
					draft.willEndAt = dayjsLib(draft.willEndAt)
						.add(dayjsLib().diff(draft.wasPausedAt, "second"), "second")
						.toISOString();
					draft.wasPausedAt = draft.wasPausedAt
						? undefined
						: dayjsLib().toISOString();
				}),
			);
	};
	const stopTimer = () => {
		const triggeredBy = currentTimer?.triggeredBy;
		if (currentWorkout && triggeredBy) {
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const exercise = draft.exercises.find(
						(e) => e.identifier === triggeredBy.exerciseIdentifier,
					);
					if (exercise) {
						const setIdx = exercise.sets.findIndex(
							(s) => s.identifier === triggeredBy.setIdentifier,
						);
						const restTimer = exercise.sets[setIdx].restTimer;
						if (restTimer) restTimer.hasElapsed = true;
					}
				}),
			);
		}
		setCurrentTimer(RESET);
	};

	return (
		<Container size="sm">
			{currentWorkout ? (
				<ClientOnly>
					{() => (
						<>
							<WorkoutModals
								stopTimer={stopTimer}
								startTimer={startTimer}
								openTimerDrawer={openTimerDrawer}
								closeTimerDrawer={closeTimerDrawer}
								assetsModalOpened={assetsModalOpened}
								timerDrawerOpened={timerDrawerOpened}
								toggleTimerDrawer={toggleTimerDrawer}
								pauseOrResumeTimer={pauseOrResumeTimer}
								setAssetsModalOpened={setAssetsModalOpened}
								isReorderDrawerOpened={isReorderDrawerOpened}
								setSupersetModalOpened={setSupersetModalOpened}
								currentWorkoutExercises={currentWorkout.exercises}
								setIsReorderDrawerOpened={setIsReorderDrawerOpened}
								supersetWithExerciseIdentifier={supersetWithExerciseIdentifier}
							/>
							<Stack ref={parent}>
								<WorkoutHeader
									stopTimer={stopTimer}
									loaderData={loaderData}
									isWorkoutPaused={isWorkoutPaused}
									isSaveBtnLoading={isSaveBtnLoading}
									numberOfExercises={numberOfExercises}
									toggleTimerDrawer={toggleTimerDrawer}
									openReorderDrawer={openReorderDrawer}
									setIsSaveBtnLoading={setIsSaveBtnLoading}
									setAssetsModalOpened={setAssetsModalOpened}
									shouldDisplayWorkoutTimer={shouldDisplayWorkoutTimer}
									shouldDisplayFinishButton={shouldDisplayFinishButton}
									shouldDisplayCancelButton={shouldDisplayCancelButton}
									shouldDisplayReorderButton={shouldDisplayReorderButton}
								/>
								{currentWorkout.exercises.map((ex, idx) => (
									<ExerciseDisplay
										exerciseIdx={idx}
										key={ex.identifier}
										stopTimer={stopTimer}
										startTimer={startTimer}
										isWorkoutPaused={isWorkoutPaused}
										openTimerDrawer={openTimerDrawer}
										reorderDrawerToggle={openReorderDrawer}
										isCreatingTemplate={loaderData.isCreatingTemplate}
										openSupersetModal={(s) => setSupersetModalOpened(s)}
										setOpenAssetsModal={() =>
											setAssetsModalOpened(ex.identifier)
										}
									/>
								))}
								<Group justify="center">
									{userPreferences.featuresEnabled.fitness.measurements ? (
										<Button
											color="teal"
											variant="subtle"
											onClick={() => setMeasurementsDrawerOpen(true)}
											style={
												loaderData.isCreatingTemplate
													? { display: "none" }
													: undefined
											}
										>
											Add measurement
										</Button>
									) : null}
									<Button
										component={Link}
										variant="subtle"
										onClick={() => advanceOnboardingTourStep()}
										to={$path("/fitness/exercises/list")}
										className={
											OnboardingTourStepTargets.ClickOnAddAnExerciseButton
										}
									>
										Add an exercise
									</Button>
								</Group>
							</Stack>
						</>
					)}
				</ClientOnly>
			) : (
				<Stack>
					<Group wrap="nowrap">
						<Skeleton h={80} w="80%" />
						<Skeleton h={80} w="20%" />
					</Group>
					<Group wrap="nowrap">
						<Skeleton h={80} w="20%" />
						<Skeleton h={80} w="80%" />
					</Group>
				</Stack>
			)}
		</Container>
	);
}
