import {
	Button,
	Checkbox,
	Group,
	Modal,
	Paper,
	ScrollArea,
	Stack,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDidUpdate } from "@mantine/hooks";
import { produce } from "immer";
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
	selectedSets: string[];
	onToggleSet: (setIdentifier: string) => void;
	onToggleExercise: (setIdentifiers: string[]) => void;
}) => {
	const [currentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const exercise = currentWorkout.exercises[props.exerciseIdx];
	const { data: exerciseDetails } = useExerciseDetails(exercise.exerciseId);

	const setIdentifiers = exercise.sets.map((s) => s.identifier);
	const selectedCount = setIdentifiers.filter((id) =>
		props.selectedSets.includes(id),
	).length;
	const isFullySelected = selectedCount === setIdentifiers.length;
	const isPartiallySelected = selectedCount > 0 && !isFullySelected;

	return (
		<Paper p="sm" withBorder radius="md" id={`delete-${exercise.identifier}`}>
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
							checked={props.selectedSets.includes(set.identifier)}
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

	const form = useForm<{ selectedSets: string[] }>({
		mode: "uncontrolled",
		initialValues: {
			selectedSets: [],
		},
		validate: {
			selectedSets: (value) =>
				value.length > 0 ? null : "Select at least one set to delete",
		},
	});

	useDidUpdate(() => {
		if (!props.exerciseToDelete || !currentWorkout) return;

		const exercise = currentWorkout.exercises.find(
			(ex) => ex.identifier === props.exerciseToDelete,
		);

		if (!exercise) return;

		const setIdentifiers = exercise.sets.map((s) => s.identifier);
		form.setFieldValue("selectedSets", setIdentifiers);

		setTimeout(() => {
			const elementId = `delete-${props.exerciseToDelete}`;
			const element = document.getElementById(elementId);
			element?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, 400);
	}, [props.opened]);

	useDidUpdate(() => {
		if (!props.opened) {
			form.reset();
		}
	}, [props.opened]);

	const toggleSet = (setIdentifier: string) => {
		const currentSets = form.values.selectedSets;

		if (currentSets.includes(setIdentifier)) {
			form.setFieldValue(
				"selectedSets",
				currentSets.filter((id) => id !== setIdentifier),
			);
		} else {
			form.setFieldValue("selectedSets", [...currentSets, setIdentifier]);
		}
	};

	const toggleExercise = (setIdentifiers: string[]) => {
		const currentSets = form.values.selectedSets;
		const allSelected = setIdentifiers.every((id) => currentSets.includes(id));

		if (allSelected) {
			form.setFieldValue(
				"selectedSets",
				currentSets.filter((id) => !setIdentifiers.includes(id)),
			);
		} else {
			const newSets = [...currentSets];
			for (const id of setIdentifiers) {
				if (!newSets.includes(id)) {
					newSets.push(id);
				}
			}
			form.setFieldValue("selectedSets", newSets);
		}
	};

	const handleDelete = (values: { selectedSets: string[] }) => {
		if (!currentWorkout) return;

		openConfirmationModal(
			`This will delete ${values.selectedSets.length} set(s). You cannot undo this action. Are you sure you want to continue?`,
			() => {
				const selectedSetsSet = new Set(values.selectedSets);
				const exercisesToDelete: string[] = [];

				for (let idx = 0; idx < currentWorkout.exercises.length; idx++) {
					const exercise = currentWorkout.exercises[idx];
					const remainingSets = exercise.sets.filter(
						(set) => !selectedSetsSet.has(set.identifier),
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
								(set) => !selectedSetsSet.has(set.identifier),
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

				form.reset();
				props.onClose();
			},
		);
	};

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			title="Select sets to delete"
		>
			<form onSubmit={form.onSubmit(handleDelete)}>
				<Stack gap="md" h="60vh">
					<ScrollArea flex={1}>
						<Stack gap="sm">
							{currentWorkout?.exercises.map((_, idx) => (
								<ExerciseItem
									exerciseIdx={idx}
									onToggleSet={toggleSet}
									selectedSets={form.values.selectedSets}
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
						<Button color="red" type="submit">
							Delete Selected ({form.values.selectedSets.length})
						</Button>
					</Group>
				</Stack>
			</form>
		</Modal>
	);
};
