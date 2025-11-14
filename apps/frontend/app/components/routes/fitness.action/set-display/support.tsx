import { NumberInput, Progress, rem, useMantineTheme } from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import { produce } from "immer";
import { type RefObject, useEffect, useRef } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useForceUpdateEverySecond } from "~/lib/shared/hooks";
import {
	type CurrentWorkoutTimer,
	useCurrentWorkout,
} from "~/lib/state/fitness";

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

	useOnClickOutside(
		editRestTimerRef as RefObject<HTMLDivElement>,
		props.onClickOutside,
	);

	if (!currentWorkout) return null;

	return (
		<NumberInput
			size="xs"
			suffix="s"
			w={rem(80)}
			ref={editRestTimerRef}
			value={props.defaultDuration}
			onChange={(v) => {
				if (!v) return;
				setValue(Number.parseInt(v.toString()));
			}}
		/>
	);
};

export const DisplaySetRestTimer = (props: {
	onClick: () => void;
	currentTimer: CurrentWorkoutTimer;
}) => {
	useForceUpdateEverySecond();
	const theme = useMantineTheme();

	const rawPercentage =
		(dayjsLib(props.currentTimer.willEndAt).diff(dayjsLib(), "seconds") * 100) /
		props.currentTimer.totalTime;
	const progressPercentage = Math.max(0, Math.min(100, rawPercentage));

	const getColorIndex = () => {
		if (progressPercentage > 80) return 5;
		if (progressPercentage > 60) return 6;
		if (progressPercentage > 40) return 7;
		if (progressPercentage > 20) return 8;
		return 9;
	};

	return (
		<Progress
			onClick={props.onClick}
			transitionDuration={300}
			value={progressPercentage}
			style={{ cursor: "pointer" }}
			color={theme.colors.blue[getColorIndex()]}
		/>
	);
};
