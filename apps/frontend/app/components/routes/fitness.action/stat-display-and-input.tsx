import { Box, Flex, NumberInput, Text, rem } from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import {
	ExerciseDurationUnit,
	type WorkoutSetStatistic,
} from "@ryot/generated/graphql/backend/graphql";
import { isNumber, isString } from "@ryot/ts-utils";
import clsx from "clsx";
import { produce } from "immer";
import invariant from "tiny-invariant";
import {
	convertDurationFromMinutes,
	convertDurationToMinutes,
} from "~/components/fitness/utils";
import { useCurrentWorkout, useGetSetAtIndex } from "~/lib/state/fitness";
import {
	ACTIVE_WORKOUT_REPS_TARGET,
	ACTIVE_WORKOUT_WEIGHT_TARGET,
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/onboarding-tour";

export const StatDisplay = (props: {
	name: string;
	value: string;
	isHidden?: boolean;
	onClick?: () => void;
	highlightValue?: boolean;
}) => {
	return (
		<Box
			mx="auto"
			onClick={props.onClick}
			style={{
				display: props.isHidden ? "none" : undefined,
				cursor: props.onClick ? "pointer" : undefined,
			}}
		>
			<Text
				ta="center"
				fz={{ md: "xl" }}
				c={props.highlightValue ? "red" : undefined}
			>
				{props.value}
			</Text>
			<Text c="dimmed" size="sm" ta="center">
				{props.name}
			</Text>
		</Box>
	);
};

export const StatInput = (props: {
	setIdx: number;
	inputStep?: number;
	exerciseIdx: number;
	stat: keyof WorkoutSetStatistic;
	durationUnit?: ExerciseDurationUnit;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);

	const getDisplayValue = () => {
		const backendValue = set.statistic[props.stat];
		if (!isString(backendValue)) return undefined;

		if (props.stat === "duration" && props.durationUnit) {
			return convertDurationFromMinutes(backendValue, props.durationUnit);
		}
		return Number(backendValue);
	};

	const [value, setValue] = useDebouncedState<string | number | undefined>(
		getDisplayValue(),
		500,
	);
	const { advanceOnboardingTourStep } = useOnboardingTour();

	const weightStepTourClassName =
		props.stat === "weight" && props.setIdx === 0
			? OnboardingTourStepTargets.AddWeightToExercise
			: undefined;

	const repsStepTourClassName =
		props.stat === "reps" && props.setIdx === 0
			? OnboardingTourStepTargets.AddRepsToExercise
			: undefined;

	useDidUpdate(() => {
		if (currentWorkout)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					let val: string | null = null;

					if (!isString(value) && isNumber(value)) {
						if (props.stat === "duration" && props.durationUnit) {
							const minutes = convertDurationToMinutes(
								value,
								props.durationUnit,
							);
							val = minutes.toString();
						} else {
							val = value.toString();
						}
					}

					const draftSet =
						draft.exercises[props.exerciseIdx].sets[props.setIdx];
					draftSet.statistic[props.stat] = val;
					if (val === null) draftSet.confirmedAt = null;
					if (weightStepTourClassName && val === ACTIVE_WORKOUT_WEIGHT_TARGET)
						advanceOnboardingTourStep();
					if (repsStepTourClassName && val === ACTIVE_WORKOUT_REPS_TARGET)
						advanceOnboardingTourStep();
				}),
			);
	}, [value, props.stat, props.setIdx, props.exerciseIdx, props.durationUnit]);

	const getInputStep = () => {
		if (props.inputStep !== undefined) return props.inputStep;
		if (
			props.stat === "duration" &&
			props.durationUnit === ExerciseDurationUnit.Seconds
		) {
			return 1;
		}
		return undefined;
	};

	const inputStep = getInputStep();

	return currentWorkout ? (
		<Flex flex={1} justify="center">
			<NumberInput
				size="xs"
				required
				hideControls
				step={inputStep}
				value={getDisplayValue()}
				onFocus={(e) => e.target.select()}
				onChange={(v) => setValue(v)}
				inputMode={props.stat === "reps" ? "numeric" : "decimal"}
				className={clsx(weightStepTourClassName, repsStepTourClassName)}
				styles={{
					input: { fontSize: 15, width: rem(72), textAlign: "center" },
				}}
				decimalScale={
					props.stat === "duration" &&
					props.durationUnit === ExerciseDurationUnit.Seconds
						? 0
						: isNumber(inputStep)
							? Math.log10(1 / inputStep)
							: undefined
				}
			/>
		</Flex>
	) : null;
};
