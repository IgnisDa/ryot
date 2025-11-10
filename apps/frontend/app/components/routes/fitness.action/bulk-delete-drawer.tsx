import {
	Button,
	Checkbox,
	Drawer,
	Group,
	Paper,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import { useState } from "react";
import invariant from "tiny-invariant";
import { getSetStatisticsTextToDisplay } from "~/components/fitness/utils";
import { useExerciseDetails } from "~/lib/shared/hooks";
import { useCurrentWorkout } from "~/lib/state/fitness";

const ExerciseItem = (props: {
	exerciseIdx: number;
	selectedSets: Set<string>;
	onToggleSet: (setIdentifier: string) => void;
	onToggleExercise: (setIdentifiers: string[]) => void;
}) => {
	const [currentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const exercise = currentWorkout.exercises[props.exerciseIdx];
	const { data: exerciseDetails } = useExerciseDetails(exercise.exerciseId);

	const setIdentifiers = exercise.sets.map((s) => s.identifier);
	const selectedCount = setIdentifiers.filter((id) =>
		props.selectedSets.has(id),
	).length;
	const isFullySelected = selectedCount === setIdentifiers.length;
	const isPartiallySelected = selectedCount > 0 && !isFullySelected;

	return (
		<Paper withBorder radius="md" p="sm">
			<Group justify="space-between">
				<Checkbox
					checked={isFullySelected}
					indeterminate={isPartiallySelected}
					label={exerciseDetails?.name || "Loading..."}
					onChange={() => props.onToggleExercise(setIdentifiers)}
				/>
			</Group>

			<Stack gap="xs" mt="xs" ml="lg">
				{exercise.sets.map((set) => {
					const [firstStat] = getSetStatisticsTextToDisplay(
						exercise.lot,
						set.statistic,
						exercise.unitSystem,
					);

					return (
						<Checkbox
							size="sm"
							label={firstStat}
							key={set.identifier}
							checked={props.selectedSets.has(set.identifier)}
							onChange={() => props.onToggleSet(set.identifier)}
						/>
					);
				})}
			</Stack>
		</Paper>
	);
};

export const BulkDeleteDrawer = (props: {
	opened: boolean;
	onClose: () => void;
}) => {
	const [currentWorkout] = useCurrentWorkout();
	const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());

	const toggleSet = (setIdentifier: string) => {
		setSelectedSets((prev) => {
			const newSet = new Set(prev);

			if (newSet.has(setIdentifier)) newSet.delete(setIdentifier);
			else newSet.add(setIdentifier);

			return newSet;
		});
	};

	const toggleExercise = (setIdentifiers: string[]) => {
		setSelectedSets((prev) => {
			const newSet = new Set(prev);
			const allSelected = setIdentifiers.every((id) => newSet.has(id));

			if (allSelected) for (const id of setIdentifiers) newSet.delete(id);
			else for (const id of setIdentifiers) newSet.add(id);

			return newSet;
		});
	};

	const handleDelete = () => {
		// No-op for now
	};

	return (
		<Drawer
			size="sm"
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
		>
			<Stack gap="md" h="95vh">
				<Text size="lg" fw="bold">
					Select Sets to Delete
				</Text>

				<ScrollArea flex={1}>
					<Stack gap="sm">
						{currentWorkout?.exercises.map((_, idx) => (
							<ExerciseItem
								exerciseIdx={idx}
								onToggleSet={toggleSet}
								selectedSets={selectedSets}
								onToggleExercise={toggleExercise}
								key={currentWorkout.exercises[idx].identifier}
							/>
						))}
					</Stack>
				</ScrollArea>

				<Group justify="space-between">
					<Button variant="subtle" onClick={props.onClose}>
						Cancel
					</Button>
					<Button color="red" onClick={handleDelete}>
						Delete Selected ({selectedSets.size})
					</Button>
				</Group>
			</Stack>
		</Drawer>
	);
};
