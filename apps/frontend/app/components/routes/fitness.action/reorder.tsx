import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { Drawer, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { useDidUpdate, useListState } from "@mantine/hooks";
import { isEqual } from "@ryot/ts-utils";
import {
	IconDroplet,
	IconDropletFilled,
	IconDropletHalf2Filled,
} from "@tabler/icons-react";
import { produce } from "immer";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { useExerciseDetails } from "~/lib/shared/hooks";
import { type Exercise, useCurrentWorkout } from "~/lib/state/fitness";
import { focusOnExercise, getProgressOfExercise } from "./hooks";
import { styles } from "./utils";

export const ReorderDrawer = (props: {
	opened: boolean;
	onClose: () => void;
	exerciseToReorder: string | null | undefined;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [exerciseElements, exerciseElementsHandlers] = useListState(
		currentWorkout?.exercises || [],
	);

	useDidUpdate(() => {
		const oldOrder = currentWorkout?.exercises.map((e) => e.identifier);
		const newOrder = exerciseElements.map((e) => e.identifier);
		if (!isEqual(oldOrder, newOrder)) {
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					if (!draft) return;
					draft.exercises = exerciseElements.map(
						(de) =>
							draft.exercises.find(
								(e) => e.identifier === de.identifier,
							) as Exercise,
					);
				}),
			);
			props.onClose();
		}
	}, [exerciseElements]);

	return currentWorkout ? (
		<Drawer
			size="sm"
			styles={styles}
			opened={props.opened}
			onClose={props.onClose}
		>
			<DragDropContext
				onDragEnd={({ destination, source }) => {
					if (!destination) return;
					const reorderedExerciseDestinationIndex = destination.index;
					exerciseElementsHandlers.reorder({
						from: source.index,
						to: reorderedExerciseDestinationIndex,
					});
					focusOnExercise(reorderedExerciseDestinationIndex);
				}}
			>
				<Droppable droppableId="dnd-list">
					{(provided) => (
						<Stack
							{...provided.droppableProps}
							ref={provided.innerRef}
							gap="xs"
						>
							<Text c="dimmed">Hold and release to reorder exercises</Text>
							{exerciseElements.map((exercise, index) => (
								<ReorderDrawerExerciseElement
									index={index}
									exercise={exercise}
									key={exercise.identifier}
									exerciseToReorder={props.exerciseToReorder}
								/>
							))}
							{provided.placeholder}
						</Stack>
					)}
				</Droppable>
			</DragDropContext>
		</Drawer>
	) : null;
};

const ReorderDrawerExerciseElement = (props: {
	index: number;
	exercise: Exercise;
	exerciseToReorder: string | null | undefined;
}) => {
	const [currentWorkout] = useCurrentWorkout();
	const isForThisExercise =
		props.exerciseToReorder === props.exercise.identifier;

	invariant(currentWorkout);

	const { data: exerciseDetails } = useExerciseDetails(
		props.exercise.exerciseId,
	);

	return (
		<Draggable index={props.index} draggableId={props.index.toString()}>
			{(provided) => (
				<Paper
					py={6}
					px="sm"
					withBorder
					radius="md"
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
				>
					<Group justify="space-between" wrap="nowrap">
						<Text size="sm" c={isForThisExercise ? "teal" : undefined}>
							{exerciseDetails?.name}
						</Text>
						<ThemeIcon
							size="xs"
							variant="transparent"
							color={isForThisExercise ? "teal" : "gray"}
						>
							{match(getProgressOfExercise(currentWorkout, props.index))
								.with("complete", () => <IconDropletFilled />)
								.with("in-progress", () => <IconDropletHalf2Filled />)
								.with("not-started", () => <IconDroplet />)
								.exhaustive()}
						</ThemeIcon>
					</Group>
				</Paper>
			)}
		</Draggable>
	);
};
