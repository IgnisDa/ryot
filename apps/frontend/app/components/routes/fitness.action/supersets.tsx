import { Button, Group, Modal, rem, Select, Stack, Text } from "@mantine/core";
import { type UseListStateHandlers, useListState } from "@mantine/hooks";
import { changeCase, isString } from "@ryot/ts-utils";
import { produce } from "immer";
import { useEffect, useMemo, useState } from "react";
import invariant from "tiny-invariant";
import { v4 as randomUUID } from "uuid";
import { useExerciseDetails, useGetMantineColors } from "~/lib/shared/hooks";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import {
	type Exercise,
	type Superset,
	useCurrentWorkout,
} from "~/lib/state/fitness";

export const DisplaySupersetModal = ({
	onClose,
	supersetWith,
}: {
	onClose: () => void;
	supersetWith: string | null;
}) => {
	const [cw] = useCurrentWorkout();

	const exerciseAlreadyInSuperset = useMemo(() => {
		if (cw && supersetWith) {
			const index = cw?.supersets.findIndex((s) =>
				s.exercises.includes(supersetWith),
			);
			if (index !== -1) return [index, cw.supersets[index]] as const;
		}
		return undefined;
	}, [cw, supersetWith]);

	return (
		<Modal
			onClose={onClose}
			withCloseButton={false}
			opened={isString(supersetWith)}
		>
			{supersetWith ? (
				exerciseAlreadyInSuperset ? (
					<EditSupersetModal
						onClose={onClose}
						supersetWith={supersetWith}
						superset={exerciseAlreadyInSuperset}
					/>
				) : (
					<CreateSupersetModal onClose={onClose} supersetWith={supersetWith} />
				)
			) : null}
		</Modal>
	);
};

const CreateSupersetModal = (props: {
	onClose: () => void;
	supersetWith: string;
}) => {
	const [cw, setCurrentWorkout] = useCurrentWorkout();
	const [exercises, setExercisesHandle] = useListState<string>([
		props.supersetWith,
	]);
	const colors = useGetMantineColors();
	const [allowedColors, setAllowedColors] = useState<string[]>([]);
	const [selectedColor, setSelectedColor] = useState<string>("");

	useEffect(() => {
		if (cw) {
			const newColors = colors
				.filter((c) => !["dark", "gray"].includes(c))
				.filter((c) => !cw.supersets.map((s) => s.color).includes(c));
			setAllowedColors(newColors);
			setSelectedColor(newColors[0]);
		}
	}, [cw]);

	if (!cw) return null;

	return (
		<Stack gap="lg">
			<Group wrap="nowrap">
				<Text>Select color</Text>
				<Select
					size="xs"
					value={selectedColor}
					leftSectionWidth={rem(40)}
					onChange={(v) => setSelectedColor(v ?? "")}
					data={allowedColors.map((c) => ({
						value: c,
						label: changeCase(c),
					}))}
				/>
			</Group>
			<Stack gap="xs">
				{cw.exercises.map((ex) => (
					<CreateSupersetExerciseButton
						exercise={ex}
						key={ex.identifier}
						exercises={exercises}
						selectedColor={selectedColor}
						setExercisesHandle={setExercisesHandle}
					/>
				))}
			</Stack>
			<Button
				disabled={exercises.length <= 1}
				onClick={() => {
					setCurrentWorkout(
						produce(cw, (draft) => {
							draft.supersets.push({
								exercises,
								color: selectedColor,
								identifier: randomUUID(),
							});
						}),
					);
					props.onClose();
				}}
			>
				Create superset
			</Button>
		</Stack>
	);
};

const CreateSupersetExerciseButton = (props: {
	exercise: Exercise;
	exercises: string[];
	selectedColor: string;
	setExercisesHandle: UseListStateHandlers<string>;
}) => {
	const [cw] = useCurrentWorkout();
	const index = props.exercises.indexOf(props.exercise.identifier);
	invariant(cw);

	const { data: exerciseDetails } = useExerciseDetails(
		props.exercise.exerciseId,
	);

	return (
		<Button
			size="xs"
			fullWidth
			color={props.selectedColor}
			variant={index !== -1 ? "light" : "outline"}
			disabled={cw.supersets
				.flatMap((s) => s.exercises)
				.includes(props.exercise.identifier)}
			onClick={() => {
				if (index !== -1) props.setExercisesHandle.remove(index);
				else props.setExercisesHandle.append(props.exercise.identifier);
			}}
		>
			{exerciseDetails?.name}
		</Button>
	);
};

const EditSupersetModal = (props: {
	onClose: () => void;
	supersetWith: string;
	superset: readonly [number, Superset];
}) => {
	const [cw, setCurrentWorkout] = useCurrentWorkout();
	const [exercises, setExercisesHandle] = useListState<string>(
		props.superset[1].exercises,
	);

	if (!cw) return null;

	return (
		<Stack gap="lg">
			<Text>Editing {props.superset[1].color} superset:</Text>
			<Stack gap="xs">
				{cw.exercises.map((ex) => (
					<EditSupersetExerciseButton
						exercise={ex}
						key={ex.identifier}
						exercises={exercises}
						superset={props.superset[1]}
						setExercisesHandle={setExercisesHandle}
					/>
				))}
			</Stack>
			<Group wrap="nowrap">
				<Button
					color="red"
					flex="none"
					onClick={() => {
						openConfirmationModal(
							"Are you sure you want to delete this superset?",
							() => {
								setCurrentWorkout(
									produce(cw, (draft) => {
										draft.supersets.splice(props.superset[0], 1);
									}),
								);
								props.onClose();
							},
						);
					}}
				>
					Delete superset
				</Button>
				<Button
					fullWidth
					disabled={
						exercises.length <= 1 ||
						props.superset[1].exercises.length === exercises.length
					}
					onClick={() => {
						setCurrentWorkout(
							produce(cw, (draft) => {
								draft.supersets[props.superset[0]].exercises = exercises;
							}),
						);
						props.onClose();
					}}
				>
					Add to superset
				</Button>
			</Group>
		</Stack>
	);
};

const EditSupersetExerciseButton = (props: {
	exercise: Exercise;
	superset: Superset;
	exercises: string[];
	setExercisesHandle: UseListStateHandlers<string>;
}) => {
	const [cw] = useCurrentWorkout();
	const index = props.exercises.indexOf(props.exercise.identifier);
	invariant(cw);

	const { data: exerciseDetails } = useExerciseDetails(
		props.exercise.exerciseId,
	);

	return (
		<Button
			size="xs"
			fullWidth
			color={props.superset.color}
			variant={index !== -1 ? "light" : "outline"}
			disabled={cw.supersets
				.filter((s) => s.identifier !== props.superset.identifier)
				.flatMap((s) => s.exercises)
				.includes(props.exercise.identifier)}
			onClick={() => {
				if (index !== -1) props.setExercisesHandle.remove(index);
				else props.setExercisesHandle.append(props.exercise.identifier);
			}}
		>
			{exerciseDetails?.name}
		</Button>
	);
};
