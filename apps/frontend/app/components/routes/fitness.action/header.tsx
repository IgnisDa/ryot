import { Button, Divider, Group, SimpleGrid } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	CreateOrUpdateUserWorkoutDocument,
	CreateOrUpdateUserWorkoutTemplateDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { sum } from "@ryot/ts-utils";
import { RESET } from "jotai/utils";
import { useNavigate } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { displayWeightWithUnit } from "~/components/fitness/utils";
import {
	useApplicationEvents,
	useDeleteS3AssetMutation,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	currentWorkoutToCreateWorkoutInput,
	useCurrentWorkout,
} from "~/lib/state/fitness";
import {
	OnboardingTourStepTarget,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";
import { FitnessAction, FitnessEntity } from "~/lib/types";
import { NameAndOtherInputs } from "./miscellaneous";
import { RestTimer, WorkoutDurationTimer } from "./rest-timer";
import { StatDisplay } from "./stat-display-and-input";

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

export function WorkoutHeader(props: HeaderProps) {
	const navigate = useNavigate();
	const events = useApplicationEvents();
	const unitSystem = useUserUnitSystem();
	const deleteS3AssetMutation = useDeleteS3AssetMutation();
	const { advanceOnboardingTourStep } = useOnboardingTour();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();

	if (!currentWorkout) return null;

	return (
		<>
			<NameAndOtherInputs
				isCreatingTemplate={props.loaderData.isCreatingTemplate}
				openAssetsModal={() => props.setAssetsModalOpened(null)}
			/>
			<Group>
				<WorkoutDurationTimer
					isWorkoutPaused={props.isWorkoutPaused}
					isUpdatingWorkout={props.loaderData.isUpdatingWorkout}
					isCreatingTemplate={props.loaderData.isCreatingTemplate}
				/>
				<StatDisplay
					name="Exercises"
					value={
						props.loaderData.isCreatingTemplate
							? props.numberOfExercises.toString()
							: `${
									currentWorkout.exercises
										.map((e) => e.sets.every((s) => s.confirmedAt))
										.filter(Boolean).length
								}/${props.numberOfExercises}`
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
									props.loaderData.isCreatingTemplate || s.confirmedAt
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
								props.loaderData.isCreatingTemplate || s.confirmedAt ? 1 : 0,
							),
					).toString()}
				/>
			</Group>
			<Divider />
			<SimpleGrid
				cols={
					Number(props.shouldDisplayWorkoutTimer) +
					Number(props.shouldDisplayReorderButton) +
					Number(props.shouldDisplayFinishButton) +
					Number(props.shouldDisplayCancelButton)
				}
			>
				{props.shouldDisplayWorkoutTimer ? (
					<Button
						radius="md"
						color="orange"
						variant="subtle"
						size="compact-sm"
						onClick={props.toggleTimerDrawer}
					>
						<RestTimer />
					</Button>
				) : null}
				{props.shouldDisplayReorderButton ? (
					<Button
						radius="md"
						color="blue"
						variant="subtle"
						size="compact-sm"
						onClick={() => props.openReorderDrawer(null)}
					>
						Reorder
					</Button>
				) : null}
				{props.shouldDisplayFinishButton ? (
					<Button
						radius="md"
						color="green"
						variant="subtle"
						size="compact-sm"
						loading={props.isSaveBtnLoading}
						disabled={props.isWorkoutPaused}
						className={OnboardingTourStepTarget.FinishWorkout}
						onClick={() => {
							if (!currentWorkout.name) {
								notifications.show({
									color: "red",
									message: `Please give a name to the ${
										props.loaderData.isCreatingTemplate ? "template" : "workout"
									}`,
								});
								return;
							}
							openConfirmationModal(
								props.loaderData.isCreatingTemplate
									? "Only sets that have data will added. Are you sure you want to save this template?"
									: "Only sets marked as confirmed will be recorded. Are you sure you want to finish this workout?",
								async () => {
									props.setIsSaveBtnLoading(true);
									advanceOnboardingTourStep();

									await new Promise((r) => setTimeout(r, 1000));
									const input = currentWorkoutToCreateWorkoutInput(
										currentWorkout,
										props.loaderData.isCreatingTemplate,
									);
									for (const exercise of currentWorkout.exercises) {
										queryClient.removeQueries({
											queryKey: queryFactory.fitness.userExerciseDetails(
												exercise.exerciseId,
											).queryKey,
										});
									}
									props.stopTimer();
									try {
										const [entityId, fitnessEntity] = await match(
											props.loaderData.isCreatingTemplate,
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
										if (props.loaderData.action === FitnessAction.LogWorkout)
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
										props.setIsSaveBtnLoading(false);
									}
								},
							);
						}}
					>
						{props.loaderData.isCreatingTemplate ||
						props.loaderData.isUpdatingWorkout
							? "Save"
							: "Finish"}
					</Button>
				) : null}
				{props.shouldDisplayCancelButton ? (
					<Button
						radius="md"
						color="red"
						variant="subtle"
						size="compact-sm"
						onClick={() => {
							openConfirmationModal(
								`Are you sure you want to cancel this ${
									props.loaderData.isCreatingTemplate ? "template" : "workout"
								}?`,
								async () => {
									await Promise.all(
										currentWorkout.exercises.flatMap((e) =>
											[...e.images, ...e.videos].map((asset) =>
												deleteS3AssetMutation.mutateAsync(asset),
											),
										),
									);
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
