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
import { ExerciseHistory } from "~/components/fitness/components";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { useCoreDetails } from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import {
	convertEnumToSelectData,
	getSurroundingElements,
	openConfirmationModal,
} from "~/lib/shared/ui-utils";
import {
	convertHistorySetToCurrentSet,
	getWorkoutDetails,
	useCurrentWorkout,
	useExerciseImages,
} from "~/lib/state/fitness";
import { FitnessEntity } from "~/lib/types";

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

export const ExerciseDetailsModal = (props: ExerciseDetailsModalProps) => {
	const coreDetails = useCoreDetails();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [activeHistoryIdx, setActiveHistoryIdx] = useState(0);

	const exerciseHistory = props.userExerciseDetails?.history;
	const images = useExerciseImages(props.exerciseDetails);

	return (
		<Modal
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title={
				<Anchor
					fw="bold"
					component={Link}
					to={getExerciseDetailsPath(props.exerciseId)}
				>
					{props.exerciseName || "..."}
				</Anchor>
			}
		>
			<FocusTrap.InitialFocus />
			<Stack>
				<Select
					size="sm"
					label="Unit system"
					allowDeselect={false}
					value={props.selectedUnitSystem}
					data={convertEnumToSelectData(UserUnitSystem)}
					onChange={(v) => {
						if (!currentWorkout) return;
						setCurrentWorkout(
							produce(currentWorkout, (draft) => {
								draft.exercises[props.exerciseIdx].unitSystem =
									v as UserUnitSystem;
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
										fitnessEntityType={FitnessEntity.Workouts}
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
															draft.exercises[props.exerciseIdx].sets.push(
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
