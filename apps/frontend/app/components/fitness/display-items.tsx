import { Alert, Avatar } from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { changeCase, isNumber, snakeCase } from "@ryot/ts-utils";
import { IconBellRinging } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { $path } from "safe-routes";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useExerciseDetails,
	useUserDetails,
	useUserExerciseDetails,
	useUserWorkoutDetails,
	useUserWorkoutTemplateDetails,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import { useExerciseImages } from "~/lib/state/fitness";
import { useFullscreenImage } from "~/lib/state/general";
import { FitnessEntity } from "~/lib/types";
import { BaseEntityDisplayItem } from "../common/entity-display";

export const ExerciseDisplayItem = (props: {
	exerciseId: string;
	centerElement?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: exerciseDetails, isLoading: isExerciseDetailsLoading } =
		useExerciseDetails(props.exerciseId, inViewport);
	const { data: userExerciseDetails } = useUserExerciseDetails(
		props.exerciseId,
		inViewport,
	);
	const images = useExerciseImages(exerciseDetails);
	const times = userExerciseDetails?.details?.exerciseNumTimesInteracted;

	return (
		<BaseEntityDisplayItem
			ref={ref}
			image={images.at(0)}
			entityId={props.exerciseId}
			title={exerciseDetails?.name}
			entityLot={EntityLot.Exercise}
			interactionButtons={["collection"]}
			centerElement={props.centerElement}
			isDetailsLoading={isExerciseDetailsLoading}
			onImageClickBehavior={[getExerciseDetailsPath(props.exerciseId)]}
			additionalInformation={[
				isNumber(times) ? `${times} time${times > 1 ? "s" : ""}` : undefined,
				changeCase(snakeCase(EntityLot.Exercise)),
			]}
		/>
	);
};

export const WorkoutDisplayItem = (props: {
	workoutId: string;
	centerElement?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: workoutDetails, isLoading: isWorkoutDetailsLoading } =
		useUserWorkoutDetails(props.workoutId, inViewport);

	const workoutDateText = workoutDetails?.details.startTime
		? dayjsLib(workoutDetails.details.startTime).format("l")
		: undefined;

	return (
		<BaseEntityDisplayItem
			ref={ref}
			entityId={props.workoutId}
			entityLot={EntityLot.Workout}
			interactionButtons={["collection"]}
			centerElement={props.centerElement}
			title={workoutDetails?.details.name}
			isDetailsLoading={isWorkoutDetailsLoading}
			additionalInformation={[
				workoutDateText,
				changeCase(snakeCase(EntityLot.Workout)),
			]}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					entity: "workouts",
					id: props.workoutId,
				}),
			]}
		/>
	);
};

export const WorkoutTemplateDisplayItem = (props: {
	centerElement?: ReactNode;
	workoutTemplateId: string;
}) => {
	const { ref, inViewport } = useInViewport();
	const {
		data: workoutTemplateDetails,
		isLoading: isWorkoutTemplateDetailsLoading,
	} = useUserWorkoutTemplateDetails(props.workoutTemplateId, inViewport);

	const createdDateText = workoutTemplateDetails?.details.createdOn
		? dayjsLib(workoutTemplateDetails.details.createdOn).format("l")
		: undefined;

	return (
		<BaseEntityDisplayItem
			ref={ref}
			entityId={props.workoutTemplateId}
			interactionButtons={["collection"]}
			centerElement={props.centerElement}
			entityLot={EntityLot.WorkoutTemplate}
			title={workoutTemplateDetails?.details.name}
			isDetailsLoading={isWorkoutTemplateDetailsLoading}
			additionalInformation={[
				createdDateText,
				changeCase(snakeCase(EntityLot.WorkoutTemplate)),
			]}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					id: props.workoutTemplateId,
					entity: FitnessEntity.Templates,
				}),
			]}
		/>
	);
};

export const ExerciseImagesList = (props: { images: string[] }) => {
	const { setFullscreenImage } = useFullscreenImage();

	return (
		<Avatar.Group>
			{props.images.map((i) => (
				<Avatar
					key={i}
					src={i}
					style={{ cursor: "pointer" }}
					onClick={() => setFullscreenImage({ src: i })}
				/>
			))}
		</Avatar.Group>
	);
};

export const WorkoutRevisionScheduledAlert = () => {
	const userDetails = useUserDetails();

	return userDetails.extraInformation?.scheduledForWorkoutRevision ? (
		<Alert icon={<IconBellRinging />}>
			A workout revision has been scheduled. Workout details might be outdated
			until revision is complete.
		</Alert>
	) : null;
};
