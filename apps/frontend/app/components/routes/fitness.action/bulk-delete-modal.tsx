import {
	Button,
	Checkbox,
	Group,
	Modal,
	Paper,
	ScrollArea,
	Stack,
} from "@mantine/core";
import { useDidUpdate } from "@mantine/hooks";
import { produce } from "immer";
import { useState } from "react";
import invariant from "tiny-invariant";
import { getSetStatisticsTextToDisplay } from "~/components/fitness/utils";
import {
	useDeleteS3AssetMutation,
	useExerciseDetails,
} from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
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

export const BulkDeleteModal = (props: {
	opened: boolean;
	onClose: () => void;
	exerciseToDelete: string | null | undefined;
}) => {
	const deleteS3AssetMutation = useDeleteS3AssetMutation();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());

	useDidUpdate(() => {
		if (!props.exerciseToDelete || !currentWorkout) return;

		const exercise = currentWorkout.exercises.find(
			(ex) => ex.identifier === props.exerciseToDelete,
		);

		if (!exercise) return;

		const setIdentifiers = exercise.sets.map((s) => s.identifier);
		setSelectedSets(new Set(setIdentifiers));
	}, [props.opened]);

	useDidUpdate(() => {
		if (!props.opened) {
			setSelectedSets(new Set());
		}
	}, [props.opened]);

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
		if (!currentWorkout || selectedSets.size === 0) return;

		openConfirmationModal(
			`This will delete ${selectedSets.size} set(s). You cannot undo this action. Are you sure you want to continue?`,
			() => {
				const exercisesToDelete: string[] = [];

				for (let idx = 0; idx < currentWorkout.exercises.length; idx++) {
					const exercise = currentWorkout.exercises[idx];
					const remainingSets = exercise.sets.filter(
						(set) => !selectedSets.has(set.identifier),
					);

					if (remainingSets.length === 0) {
						exercisesToDelete.push(exercise.identifier);
						const assets = [...exercise.images, ...exercise.videos];
						for (const asset of assets) deleteS3AssetMutation.mutate(asset);
					}
				}

				setCurrentWorkout(
					produce(currentWorkout, (draft) => {
						for (let idx = draft.exercises.length - 1; idx >= 0; idx--) {
							const exercise = draft.exercises[idx];

							draft.exercises[idx].sets = exercise.sets.filter(
								(set) => !selectedSets.has(set.identifier),
							);

							if (draft.exercises[idx].sets.length === 0) {
								const supersetIdx = draft.supersets.findIndex((s) =>
									s.exercises.includes(exercise.identifier),
								);

								if (supersetIdx !== -1) {
									if (draft.supersets[supersetIdx].exercises.length === 2)
										draft.supersets.splice(supersetIdx, 1);
									else
										draft.supersets[supersetIdx].exercises = draft.supersets[
											supersetIdx
										].exercises.filter((e) => e !== exercise.identifier);
								}

								draft.exercises.splice(idx, 1);
							}
						}
					}),
				);

				setSelectedSets(new Set());
				props.onClose();
			},
		);
	};

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			title="Select sets to delete"
		>
			<Stack gap="md" h="60vh">
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
		</Modal>
	);
};
