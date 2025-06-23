import { Flex, NumberInput, rem } from "@mantine/core";
import { useDebouncedState, useDidUpdate } from "@mantine/hooks";
import type { WorkoutSetStatistic } from "@ryot/generated/graphql/backend/graphql";
import { isString } from "@ryot/ts-utils";
import { isNumber } from "@ryot/ts-utils";
import clsx from "clsx";
import { produce } from "immer";
import invariant from "tiny-invariant";
import { useCurrentWorkout, useGetSetAtIndex } from "~/lib/state/fitness";
import {
	ACTIVE_WORKOUT_REPS_TARGET,
	ACTIVE_WORKOUT_WEIGHT_TARGET,
	OnboardingTourStepTargets,
	useOnboardingTour,
} from "~/lib/state/general";

export const StatInput = (props: {
	setIdx: number;
	inputStep?: number;
	exerciseIdx: number;
	stat: keyof WorkoutSetStatistic;
}) => {
	const [currentWorkout, setCurrentWorkout] = useCurrentWorkout();
	const set = useGetSetAtIndex(props.exerciseIdx, props.setIdx);
	invariant(set);
	const [value, setValue] = useDebouncedState<string | number | undefined>(
		isString(set.statistic[props.stat])
			? Number(set.statistic[props.stat])
			: undefined,
		500,
	);
	const { isOnboardingTourInProgress, advanceOnboardingTourStep } =
		useOnboardingTour();

	const weightStepTourClassName =
		isOnboardingTourInProgress && props.stat === "weight" && props.setIdx === 0
			? OnboardingTourStepTargets.AddWeightToExercise
			: undefined;

	const repsStepTourClassName =
		isOnboardingTourInProgress && props.stat === "reps" && props.setIdx === 0
			? OnboardingTourStepTargets.AddRepsToExercise
			: undefined;

	useDidUpdate(() => {
		if (currentWorkout)
			setCurrentWorkout(
				produce(currentWorkout, (draft) => {
					const val = isString(value) ? null : value?.toString();
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
	}, [value]);

	return currentWorkout ? (
		<Flex style={{ flex: 1 }} justify="center">
			<NumberInput
				size="xs"
				required
				hideControls
				step={props.inputStep}
				onChange={(v) => setValue(v)}
				onFocus={(e) => e.target.select()}
				className={clsx(weightStepTourClassName, repsStepTourClassName)}
				styles={{
					input: { fontSize: 15, width: rem(72), textAlign: "center" },
				}}
				value={
					isString(set.statistic[props.stat])
						? Number(set.statistic[props.stat])
						: undefined
				}
				decimalScale={
					isNumber(props.inputStep) && props.inputStep
						? Math.log10(1 / props.inputStep)
						: undefined
				}
			/>
		</Flex>
	) : null;
};
