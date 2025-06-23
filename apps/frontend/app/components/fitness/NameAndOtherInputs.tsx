import {
	ActionIcon,
	Anchor,
	Group,
	Modal,
	NumberInput,
	Stack,
	Text,
	TextInput,
	Textarea,
} from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { isNumber } from "@ryot/ts-utils";
import { IconCamera } from "@tabler/icons-react";
import { produce } from "immer";
import { useState } from "react";
import invariant from "tiny-invariant";
import { useUserPreferences } from "~/lib/hooks";
import { useCurrentWorkout } from "~/lib/state/fitness";

export const NameAndOtherInputs = (props: {
	isCreatingTemplate: boolean;
	openAssetsModal: () => void;
}) => {
	const userPreferences = useUserPreferences();
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	invariant(currentWorkout);

	const [name, setName] = useDebouncedState(currentWorkout.name, 500);
	const [comment, setComment] = useDebouncedState(currentWorkout.comment, 500);
	const [isCaloriesBurntModalOpen, setIsCaloriesBurntModalOpen] =
		useState(false);
	const [caloriesBurnt, setCaloriesBurnt] = useDebouncedState(
		currentWorkout.caloriesBurnt,
		500,
	);
	const workoutHasImages = currentWorkout.images.length > 0;

	useDidUpdate(() => {
		if (name)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.name = name;
				}),
			);
	}, [name]);

	useDidUpdate(() => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.comment = comment || undefined;
			}),
		);
	}, [comment]);

	useDidUpdate(() => {
		setCurrentWorkout(
			produce(currentWorkout, (draft) => {
				draft.caloriesBurnt = caloriesBurnt;
			}),
		);
	}, [caloriesBurnt]);

	return (
		<>
			<Modal
				title="Additional details"
				opened={isCaloriesBurntModalOpen}
				onClose={() => setIsCaloriesBurntModalOpen(false)}
			>
				<Stack gap="xs">
					<NumberInput
						size="sm"
						value={currentWorkout.caloriesBurnt}
						label={`Energy burnt in ${userPreferences.fitness.logging.caloriesBurntUnit}`}
						onChange={(e) => setCaloriesBurnt(isNumber(e) ? e : undefined)}
					/>
					<Textarea
						size="sm"
						minRows={2}
						label="Comments"
						defaultValue={comment}
						placeholder="Your thoughts about this workout"
						onChange={(e) => setComment(e.currentTarget.value)}
					/>
				</Stack>
			</Modal>
			<TextInput
				size="sm"
				defaultValue={name}
				placeholder="A name for your workout"
				styles={{ label: { width: "100%" } }}
				onChange={(e) => setName(e.currentTarget.value)}
				rightSection={
					<ActionIcon
						onClick={props.openAssetsModal}
						variant={workoutHasImages ? "outline" : undefined}
					>
						<IconCamera size={30} />
					</ActionIcon>
				}
				label={
					<Group justify="space-between" mr="xs">
						<Text size="sm">Name</Text>
						{!props.isCreatingTemplate ? (
							<Anchor
								size="xs"
								onClick={() => setIsCaloriesBurntModalOpen(true)}
							>
								More Information
							</Anchor>
						) : null}
					</Group>
				}
			/>
		</>
	);
};
