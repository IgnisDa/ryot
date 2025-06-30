import { Carousel } from "@mantine/carousel";
import {
	Anchor,
	FocusTrap,
	Group,
	Image,
	Modal,
	ScrollArea,
	Select,
	Stack,
} from "@mantine/core";
import {
	type ExerciseDetailsQuery,
	type UserExerciseDetailsQuery,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import { produce } from "immer";
import { useState } from "react";
import { Link } from "react-router";
import { ProRequiredAlert } from "~/components/common";
import { ExerciseHistory } from "~/components/fitness";
import {
	FitnessEntity,
	PRO_REQUIRED_MESSAGE,
	convertEnumToSelectData,
	getExerciseDetailsPath,
	getSurroundingElements,
	openConfirmationModal,
} from "~/lib/common";
import { useCoreDetails } from "~/lib/hooks";
import {
	convertHistorySetToCurrentSet,
	getExerciseImages,
	getWorkoutDetails,
	useCurrentWorkout,
} from "~/lib/state/fitness";

interface ExerciseDetailsModalProps {
	opened: boolean;
	exerciseId: string;
	onClose: () => void;
	exerciseIdx: number;
	exerciseName?: string;
	selectedUnitSystem: UserUnitSystem;
	exerciseDetails?: ExerciseDetailsQuery["exerciseDetails"];
	userExerciseDetails?: UserExerciseDetailsQuery["userExerciseDetails"];
}

export const ExerciseDetailsModal = ({
	opened,
	onClose,
	exerciseIdx,
	exerciseId,
	exerciseName,
	exerciseDetails,
	userExerciseDetails,
	selectedUnitSystem,
}: ExerciseDetailsModalProps) => {
	const coreDetails = useCoreDetails();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [activeHistoryIdx, setActiveHistoryIdx] = useState(0);

	const exerciseHistory = userExerciseDetails?.history;
	const images = getExerciseImages(exerciseDetails);

	return (
		<Modal
			size="lg"
			opened={opened}
			onClose={onClose}
			title={
				<Anchor
					fw="bold"
					component={Link}
					to={getExerciseDetailsPath(exerciseId)}
				>
					{exerciseName || "..."}
				</Anchor>
			}
		>
			<FocusTrap.InitialFocus />
			<Stack>
				<Select
					size="sm"
					label="Unit system"
					allowDeselect={false}
					value={selectedUnitSystem}
					data={convertEnumToSelectData(UserUnitSystem)}
					onChange={(v) => {
						if (!currentWorkout) return;
						setCurrentWorkout(
							produce(currentWorkout, (draft) => {
								draft.exercises[exerciseIdx].unitSystem = v as UserUnitSystem;
							}),
						);
					}}
				/>
				<ScrollArea type="scroll">
					<Group wrap="nowrap">
						{images.map((i) => (
							<Image key={i} src={i} h={200} w={350} radius="md" />
						))}
					</Group>
				</ScrollArea>
				{coreDetails.isServerKeyValidated ? (
					<Carousel
						slideGap="md"
						withControls={false}
						style={{ userSelect: "none" }}
						emblaOptions={{ align: "start" }}
						onSlideChange={setActiveHistoryIdx}
						slideSize={{ base: "100%", md: "50%" }}
					>
						{exerciseHistory?.map((history, idx: number) => (
							<Carousel.Slide key={`${history.workoutId}-${history.idx}`}>
								{getSurroundingElements(
									exerciseHistory,
									activeHistoryIdx,
								).includes(idx) ? (
									<ExerciseHistory
										hideExerciseDetails
										hideExtraDetailsButton
										exerciseIdx={history.idx}
										entityId={history.workoutId}
										entityType={FitnessEntity.Workouts}
										onCopyButtonClick={async () => {
											const workout = await getWorkoutDetails(
												history.workoutId,
											);
											openConfirmationModal(
												`Are you sure you want to copy all sets from "${workout.details.name}"?`,
												() => {
													const sets =
														workout.details.information.exercises[history.idx]
															.sets;
													const converted = sets.map((set) =>
														convertHistorySetToCurrentSet(set),
													);
													if (!currentWorkout) return;
													setCurrentWorkout(
														produce(currentWorkout, (draft) => {
															draft.exercises[exerciseIdx].sets.push(
																...converted,
															);
														}),
													);
												},
											);
										}}
									/>
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<ProRequiredAlert
						alertText={`${PRO_REQUIRED_MESSAGE}: inline workout history.`}
					/>
				)}
			</Stack>
		</Modal>
	);
};
