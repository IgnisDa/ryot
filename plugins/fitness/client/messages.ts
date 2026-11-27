import type { SelectCodes } from "@ryot-app/plugin-client-sdk";
import {
	useLocalMessage,
	useMessages,
	useStampedMessages,
} from "@ryot-app/plugin-client-sdk/react";
import { countUnit } from "@ryot-app/plugin-ui-sdk";
import { useMemo } from "react";

import type {
	ExerciseForce,
	ExerciseKind,
	ExerciseLevel,
	ExerciseMechanic,
} from "../shared/exercise-kinds";
import {
	exerciseForceLabels,
	exerciseKindLabels,
	exerciseLevelLabels,
	exerciseMechanicLabels,
} from "../shared/exercise-labels";
import { type Catalog, catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export const useFitnessMessages = () => useMessages(PLUGIN_PACKAGE_ID, catalogMessage);

/** The plugin's messages stamped for the host, such as screen titles. */
export const useFitnessMessageBuilder = () => useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);

export type FitnessText = ReturnType<typeof useFitnessMessages>;

export const countUnits =
	(text: FitnessText) => (noun: SelectCodes<Catalog, "common.unit.count", "noun">) =>
		countUnit((count) => text("common.unit.count", { noun, count }));

export const useCountUnits = () => {
	const text = useFitnessMessages();
	return useMemo(() => countUnits(text), [text]);
};

export type ExerciseLabels = ReturnType<typeof useExerciseLabels>;

export const useExerciseLabels = () => {
	const text = useFitnessMessages();
	const local = useLocalMessage(PLUGIN_PACKAGE_ID);
	return useMemo(
		() => ({
			force: (force: ExerciseForce) => local(exerciseForceLabels[force]),
			level: (level: ExerciseLevel) => local(exerciseLevelLabels[level]),
			mechanic: (mechanic: ExerciseMechanic) => local(exerciseMechanicLabels[mechanic]),
			kind: (kind: null | ExerciseKind) =>
				kind === null ? text("client.editor.exercise") : local(exerciseKindLabels[kind]),
		}),
		[local, text],
	);
};
