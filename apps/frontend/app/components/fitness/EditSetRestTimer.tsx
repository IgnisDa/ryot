import { NumberInput, rem } from "@mantine/core";
import {
	useClickOutside,
	useDebouncedState,
	useDidUpdate,
} from "@mantine/hooks";
import { produce } from "immer";
import { useEffect, useRef } from "react";
import { useCurrentWorkout } from "~/lib/state/fitness";

export const EditSetRestTimer = (props: {
	setIdx: number;
	exerciseIdx: number;
	defaultDuration: number;
	onClickOutside: () => void;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const editRestTimerRef = useRef<HTMLInputElement>(null);

	const [value, setValue] = useDebouncedState(props.defaultDuration, 500);

	useDidUpdate(() => {
		if (currentWorkout && value)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const exercise = draft.exercises[props.exerciseIdx];
					exercise.sets[props.setIdx].restTimer = { duration: value };
				}),
			);
	}, [value]);

	useEffect(() => {
		editRestTimerRef.current?.select();
	}, [editRestTimerRef]);

	useClickOutside(props.onClickOutside, null, [editRestTimerRef.current]);

	if (!currentWorkout) return null;

	return (
		<NumberInput
			size="xs"
			suffix="s"
			w={rem(80)}
			// This will be fixed when https://github.com/mantinedev/mantine/pull/6997 is merged
			ref={editRestTimerRef}
			value={props.defaultDuration}
			onChange={(v) => {
				if (!v) return;
				setValue(Number.parseInt(v.toString()));
			}}
		/>
	);
};
