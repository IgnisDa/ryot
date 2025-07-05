import { Button, Divider, Group, SimpleGrid } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CreateOrUpdateUserWorkoutDocument,
	CreateOrUpdateUserWorkoutTemplateDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import clsx from "clsx";
import { RESET } from "jotai/utils";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { displayWeightWithUnit } from "~/components/fitness/utils";
import { useApplicationEvents, useUserUnitSystem } from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/query-factory";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	currentWorkoutToCreateWorkoutInput,
	useCurrentWorkout,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";
import { FitnessAction, FitnessEntity } from "~/lib/types";
import { NameAndOtherInputs } from "./miscellaneous";
import { RestTimer, WorkoutDurationTimer } from "./rest-timer";
import { StatDisplay } from "./stat-display-and-input";
import { deleteUploadedAsset } from "./utils";

interface HeaderProps {
	stopTimer: () => void;
	isWorkoutPaused: boolean;
	numberOfExercises: number;
	isSaveBtnLoading: boolean;
	toggleTimerDrawer: () => void;
	shouldDisplayFinishButton: boolean;
	shouldDisplayCancelButton: boolean;
	shouldDisplayWorkoutTimer: boolean;
	shouldDisplayReorderButton: boolean;
	setIsSaveBtnLoading: (value: boolean) => void;
	openReorderDrawer: (exerciseIdentifier: string | null) => void;
	setAssetsModalOpened: (value: string | null | undefined) => void;
	loaderData: {
		action: FitnessAction;
		isUpdatingWorkout: boolean;
		isCreatingTemplate: boolean;
	};
}

export function WorkoutHeader({
	loaderData,
	setAssetsModalOpened,
	isWorkoutPaused,
	numberOfExercises,
	shouldDisplayWorkoutTimer,
	shouldDisplayReorderButton,
	shouldDisplayFinishButton,
	shouldDisplayCancelButton,
	toggleTimerDrawer,
	openReorderDrawer,
	isSaveBtnLoading,
	setIsSaveBtnLoading,
	stopTimer,
}: HeaderProps) {
	const unitSystem = useUserUnitSystem();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const events = useApplicationEvents();
	const navigate = useNavigate();
	const { advanceOnboardingTourStep, isOnboardingTourInProgress } =
		useOnboardingTour();

	if (!currentWorkout) return null;

	return (
		<>
			<NameAndOtherInputs
				isCreatingTemplate={loaderData.isCreatingTemplate}
				openAssetsModal={() => setAssetsModalOpened(null)}
			/>
			<Group>
				<WorkoutDurationTimer
					isWorkoutPaused={isWorkoutPaused}
					isUpdatingWorkout={loaderData.isUpdatingWorkout}
					isCreatingTemplate={loaderData.isCreatingTemplate}
				/>
				<StatDisplay
					name="Exercises"
					value={
						loaderData.isCreatingTemplate
							? numberOfExercises.toString()
							: `${
									currentWorkout.exercises
										.map((e) => e.sets.every((s) => s.confirmedAt))
										.filter(Boolean).length
								}/${numberOfExercises}`
					}
				/>
				<StatDisplay
					name="Weight"
					value={`${displayWeightWithUnit(
						unitSystem,
						sum(
							currentWorkout.exercises
								.flatMap((e) => e.sets)
								.flatMap((s) =>
									loaderData.isCreatingTemplate || s.confirmedAt
										? Number(s.statistic.reps || 0) *
											Number(s.statistic.weight || 0)
										: 0,
								),
						).toFixed(),
					)}`}
				/>
				<StatDisplay
					name="Sets"
					value={sum(
						currentWorkout.exercises
							.flatMap((e) => e.sets)
							.flatMap((s) =>
								loaderData.isCreatingTemplate || s.confirmedAt ? 1 : 0,
							),
					).toString()}
				/>
			</Group>
			<Divider />
			<SimpleGrid
				cols={
					Number(shouldDisplayWorkoutTimer) +
					Number(shouldDisplayReorderButton) +
					Number(shouldDisplayFinishButton) +
					Number(shouldDisplayCancelButton)
				}
			>
				{shouldDisplayWorkoutTimer ? (
					<Button
						radius="md"
						color="orange"
						variant="subtle"
						size="compact-sm"
						onClick={toggleTimerDrawer}
					>
						<RestTimer />
					</Button>
				) : null}
				{shouldDisplayReorderButton ? (
					<Button
						radius="md"
						color="blue"
						variant="subtle"
						size="compact-sm"
						onClick={() => openReorderDrawer(null)}
					>
						Reorder
					</Button>
				) : null}
				{shouldDisplayFinishButton ? (
					<Button
						radius="md"
						color="green"
						variant="subtle"
						size="compact-sm"
						loading={isSaveBtnLoading}
						disabled={isWorkoutPaused}
						className={clsx(
							isOnboardingTourInProgress &&
								OnboardingTourStepTargets.FinishWorkout,
						)}
						onClick={() => {
							if (!currentWorkout.name) {
								notifications.show({
									color: "red",
									message: `Please give a name to the ${
										loaderData.isCreatingTemplate ? "template" : "workout"
									}`,
								});
								return;
							}
							openConfirmationModal(
								loaderData.isCreatingTemplate
									? "Only sets that have data will added. Are you sure you want to save this template?"
									: "Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
								async () => {
									setIsSaveBtnLoading(true);
									if (isOnboardingTourInProgress) advanceOnboardingTourStep();

									await new Promise((r) => setTimeout(r, 1000));
									const input = currentWorkoutToCreateWorkoutInput(
										currentWorkout,
										loaderData.isCreatingTemplate,
									);
									for (const exercise of currentWorkout.exercises) {
										queryClient.removeQueries({
											queryKey: queryFactory.fitness.userExerciseDetails(
												exercise.exerciseId,
											).queryKey,
										});
									}
									stopTimer();
									try {
										const [entityId, fitnessEntity] = await match(
											loaderData.isCreatingTemplate,
										)
											.with(true, () =>
												clientGqlService
													.request(
														CreateOrUpdateUserWorkoutTemplateDocument,
														input,
													)
													.then((c) => [
														c.createOrUpdateUserWorkoutTemplate,
														FitnessEntity.Templates,
													]),
											)
											.with(false, () =>
												clientGqlService
													.request(CreateOrUpdateUserWorkoutDocument, input)
													.then((c) => [
														c.createOrUpdateUserWorkout,
														FitnessEntity.Workouts,
													]),
											)
											.exhaustive();
										if (loaderData.action === FitnessAction.LogWorkout)
											events.createWorkout();
										setCurrentWorkout(RESET);
										navigate(
											$path("/fitness/:entity/:id", {
												id: entityId,
												entity: fitnessEntity,
											}),
										);
									} catch (e) {
										notifications.show({
											color: "red",
											message: `Error while saving workout: ${JSON.stringify(e)}`,
										});
										setIsSaveBtnLoading(false);
									}
								},
							);
						}}
					>
						{loaderData.isCreatingTemplate || loaderData.isUpdatingWorkout
							? "Save"
							: "Finish"}
					</Button>
				) : null}
				{shouldDisplayCancelButton ? (
					<Button
						radius="md"
						color="red"
						variant="subtle"
						size="compact-sm"
						onClick={() => {
							openConfirmationModal(
								`Are you sure you want to cancel this ${
									loaderData.isCreatingTemplate ? "template" : "workout"
								}?`,
								() => {
									for (const e of currentWorkout.exercises) {
										const assets = [...e.images, ...e.videos];
										for (const asset of assets) deleteUploadedAsset(asset);
									}
									navigate($path("/"), { replace: true });
									setCurrentWorkout(RESET);
								},
							);
						}}
					>
						Cancel
					</Button>
				) : null}
			</SimpleGrid>
			<Divider />
		</>
	);
}
