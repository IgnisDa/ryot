import { ActionIcon, Flex, Textarea } from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { IconTrash } from "@tabler/icons-react";
import { produce } from "immer";
import { openConfirmationModal } from "~/lib/common";
import { useCurrentWorkout } from "~/lib/state/fitness";

export const NoteInput = (props: {
	note: string;
	noteIdx: number;
	exerciseIdx: number;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const [value, setValue] = useDebouncedState(props.note, 500);

	useDidUpdate(() => {
		if (currentWorkout)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					draft.exercises[props.exerciseIdx].notes[props.noteIdx] = value;
				}),
			);
	}, [value]);

	return (
		<Flex align="center" gap="xs">
			<Textarea
				autosize
				size="xs"
				minRows={1}
				maxRows={4}
				style={{ flexGrow: 1 }}
				placeholder="Add a note"
				defaultValue={props.note}
				onChange={(e) => setValue(e.currentTarget.value)}
			/>
			<ActionIcon
				color="red"
				onClick={() => {
					openConfirmationModal(
						"This note will be deleted. Are you sure you want to continue?",
						() => {
							if (currentWorkout)
								setCurrentWorkout(
									produce(currentWorkout, (draft) => {
										draft.exercises[props.exerciseIdx].notes.splice(
											props.noteIdx,
											1,
										);
									}),
								);
						},
					);
				}}
			>
				<IconTrash size={20} />
			</ActionIcon>
		</Flex>
	);
};
