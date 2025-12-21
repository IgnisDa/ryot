import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Button, Container, Group, Skeleton, Stack } from "@mantine/core";
import { isNumber, isString, parseParameters } from "@ryot/ts-utils";
import { produce } from "immer";
import { RESET } from "jotai/utils";
import { useEffect, useRef, useState } from "react";
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
import { handleSetConfirmation } from "~/components/routes/fitness.action/set-display/functions";
import type { FuncStartTimer } from "~/components/routes/fitness.action/types";
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
	useMeasurementsDrawer,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { FitnessAction } from "~/lib/types";
import type { Route } from "./+types/_dashboard.fitness.$action";

export const loader = async ({ params }: Route.LoaderArgs) => {
	const { action } = parseParameters(
		params,
		z.object({ action: z.enum(FitnessAction) }),
	);
	return {
		action,
		isUpdatingWorkout: action === FitnessAction.UpdateWorkout,
		isCreatingTemplate: action === FitnessAction.CreateTemplate,
	};
};

export const meta = () => {
	return [{ title: "Fitness Action | Ryot" }];
};

export default function Page() {
	const [parent] = useAutoAnimate();
	const userPreferences = useUserPreferences();
	const loaderData = useLoaderData<typeof loader>();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const playCheckSound = usePlayFitnessSound("check");
	const [_, setMeasurementsDrawerData] = useMeasurementsDrawer();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [currentTimer, setCurrentTimer] = useCurrentWorkoutTimerAtom();
	const wakeLockRef = useRef<WakeLockSentinel | null>(null);
	const performTasksAfterSetConfirmed = usePerformTasksAfterSetConfirmed();
	const timerCompleteSound = usePlayFitnessSound("timer-completed");
	const [isSaveBtnLoading, setIsSaveBtnLoading] = useState(false);
	const promptForRestTimer = userPreferences.fitness.logging.promptForRestTimer;
	const {
		openTimerDrawer,
		closeTimerDrawer,
		exerciseToDelete,
		toggleTimerDrawer,
		openReorderDrawer,
		timerDrawerOpened,
		assetsModalOpened,
		openBulkDeleteModal,
		setAssetsModalOpened,
		closeBulkDeleteModal,
		isReorderDrawerOpened,
		bulkDeleteModalOpened,
		setSupersetModalOpened,
		closeNotificationModal,
		notificationModalOpened,
		setIsReorderDrawerOpened,
		supersetWithExerciseIdentifier,
	} = useWorkoutModals();

	const isWorkoutPaused = isString(currentWorkout?.durations.at(-1)?.to);
	const numberOfExercises = currentWorkout?.exercises.length || 0;
	const shouldDisplayWorkoutTimer = Boolean(
		loaderData.action === FitnessAction.LogWorkout,
	);
	const shouldDisplayCancelButton = true;
	const shouldDisplayReorderButton = Boolean(numberOfExercises > 1);
	const shouldDisplayFinishButton = Boolean(
		loaderData.isCreatingTemplate
			? numberOfExercises > 0
			: currentWorkout?.exercises.some(
					(_e, idx) =>
						getProgressOfExercise(currentWorkout, idx) !== "not-started",
				),
	);

	const playCompleteTimerSound = () => {
		timerCompleteSound();
		if (document.visibilityState === "visible") return;
		sendNotificationToServiceWorker({
			tag: "timer-completed",
			title: "Timer completed",
			body: "Let's get this done!",
			data: { event: "open-link", link: window.location.href },
		});
	};
	const startTimer: FuncStartTimer = (input) => {
		setCurrentTimer({
			totalTime: input.duration,
			triggeredBy: input.triggeredBy,
			confirmSetOnFinish: input.confirmSetOnFinish,
			willEndAt: dayjsLib().add(input.duration, "second").toISOString(),
		});
		if (input.openTimerDrawer) toggleTimerDrawer();
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

	const acquireWakeLock = async () => {
		if ("wakeLock" in navigator)
			try {
				wakeLockRef.current = await navigator.wakeLock.request("screen");
				wakeLockRef.current.addEventListener("release", () => {
					wakeLockRef.current = null;
				});
			} catch {}
	};

	const releaseWakeLock = async () => {
		if (wakeLockRef.current)
			try {
				await wakeLockRef.current.release();
				wakeLockRef.current = null;
			} catch {}
	};

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
				const confirmSetOnFinish = currentTimer?.confirmSetOnFinish;
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

				if (confirmSetOnFinish) {
					const exerciseIdx = currentWorkout?.exercises.findIndex(
						(e) => e.identifier === confirmSetOnFinish?.exerciseIdentifier,
					);
					if (!isNumber(exerciseIdx)) return;
					const exercise = currentWorkout?.exercises[exerciseIdx];
					const setIdx = exercise?.sets.findIndex(
						(s) => s.identifier === confirmSetOnFinish?.setIdentifier,
					);
					if (!isNumber(setIdx)) return;
					const set = exercise?.sets[setIdx];
					if (!set) return;
					handleSetConfirmation({
						set,
						setIdx,
						exercise,
						stopTimer,
						startTimer,
						exerciseIdx,
						currentTimer,
						currentWorkout,
						playCheckSound,
						userPreferences,
						isWorkoutPaused,
						setCurrentWorkout,
						advanceOnboardingTourStep,
						performTasksAfterSetConfirmed,
					});
				}
			}
		}
	}, 1000);
	useEffect(() => {
		acquireWakeLock();

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible" && !wakeLockRef.current)
				acquireWakeLock();
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			releaseWakeLock();
		};
	}, []);

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
								exerciseToDelete={exerciseToDelete}
								assetsModalOpened={assetsModalOpened}
								timerDrawerOpened={timerDrawerOpened}
								toggleTimerDrawer={toggleTimerDrawer}
								pauseOrResumeTimer={pauseOrResumeTimer}
								setAssetsModalOpened={setAssetsModalOpened}
								closeBulkDeleteModal={closeBulkDeleteModal}
								isReorderDrawerOpened={isReorderDrawerOpened}
								bulkDeleteModalOpened={bulkDeleteModalOpened}
								setSupersetModalOpened={setSupersetModalOpened}
								closeNotificationModal={closeNotificationModal}
								notificationModalOpened={notificationModalOpened}
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
										playCheckSound={playCheckSound}
										isWorkoutPaused={isWorkoutPaused}
										openTimerDrawer={openTimerDrawer}
										reorderDrawerToggle={openReorderDrawer}
										openBulkDeleteModal={openBulkDeleteModal}
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
											onClick={() => setMeasurementsDrawerData(null)}
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
										onClick={() => {
											setCurrentWorkout(
												produce(currentWorkout, (draft) => {
													draft.replacingExerciseIdx = undefined;
												}),
											);
											advanceOnboardingTourStep();
										}}
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
