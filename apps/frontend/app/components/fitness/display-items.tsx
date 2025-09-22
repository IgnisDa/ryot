import { Alert, Avatar } from "@mantine/core";
import { useInViewport } from "@mantine/hooks";
import { isNumber } from "@ryot/ts-utils";
import { IconBellRinging } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { $path } from "safe-routes";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useExerciseDetails,
	useUserDetails,
	useUserExerciseDetails,
} from "~/lib/shared/hooks";
import { getExerciseDetailsPath } from "~/lib/shared/media-utils";
import {
	getExerciseImages,
	getWorkoutDetailsQuery,
	getWorkoutTemplateDetailsQuery,
} from "~/lib/state/fitness";
import { useFullscreenImage } from "~/lib/state/general";
import { FitnessEntity } from "~/lib/types";
import { Old__BaseEntityDisplayItem } from "../common/entity-display";

export const Old__ExerciseDisplayItem = (props: {
	exerciseId: string;
	topLeft?: ReactNode;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: exerciseDetails, isLoading: isExerciseDetailsLoading } =
		useExerciseDetails(props.exerciseId, inViewport);
	const { data: userExerciseDetails } = useUserExerciseDetails(
		props.exerciseId,
		inViewport,
	);
	const times = userExerciseDetails?.details?.exerciseNumTimesInteracted;
	const images = getExerciseImages(exerciseDetails);

	return (
		<Old__BaseEntityDisplayItem
			innerRef={ref}
			imageUrl={images.at(0)}
			name={exerciseDetails?.name}
			isDetailsLoading={isExerciseDetailsLoading}
			onImageClickBehavior={[getExerciseDetailsPath(props.exerciseId)]}
			labels={{
				left: isNumber(times)
					? `${times} time${times > 1 ? "s" : ""}`
					: undefined,
				right: props.rightLabel,
			}}
			imageOverlay={{ topLeft: props.topLeft, topRight: props.topRight }}
		/>
	);
};

export const Old__WorkoutDisplayItem = (props: {
	workoutId: string;
	topLeft?: ReactNode;
	topRight?: ReactNode;
	rightLabel?: ReactNode;
}) => {
	const { ref, inViewport } = useInViewport();
	const { data: workoutDetails, isLoading: isWorkoutDetailsLoading } = useQuery(
		{ ...getWorkoutDetailsQuery(props.workoutId), enabled: inViewport },
	);

	return (
		<Old__BaseEntityDisplayItem
			innerRef={ref}
			name={workoutDetails?.details.name}
			isDetailsLoading={isWorkoutDetailsLoading}
			imageOverlay={{ topLeft: props.topLeft, topRight: props.topRight }}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					entity: "workouts",
					id: props.workoutId,
				}),
			]}
			labels={{
				left: dayjsLib(workoutDetails?.details.startTime).format("l"),
				right: props.rightLabel,
			}}
		/>
	);
};

export const Old__WorkoutTemplateDisplayItem = (props: {
	topLeft?: ReactNode;
	topRight?: ReactNode;
	workoutTemplateId: string;
}) => {
	const { ref, inViewport } = useInViewport();
	const {
		data: workoutTemplateDetails,
		isLoading: isWorkoutTemplateDetailsLoading,
	} = useQuery({
		...getWorkoutTemplateDetailsQuery(props.workoutTemplateId),
		enabled: inViewport,
	});

	return (
		<Old__BaseEntityDisplayItem
			innerRef={ref}
			name={workoutTemplateDetails?.details.name}
			isDetailsLoading={isWorkoutTemplateDetailsLoading}
			imageOverlay={{ topLeft: props.topLeft, topRight: props.topRight }}
			onImageClickBehavior={[
				$path("/fitness/:entity/:id", {
					id: props.workoutTemplateId,
					entity: FitnessEntity.Templates,
				}),
			]}
			labels={{
				left: dayjsLib(workoutTemplateDetails?.details.createdOn).format("l"),
				right: "Template",
			}}
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
