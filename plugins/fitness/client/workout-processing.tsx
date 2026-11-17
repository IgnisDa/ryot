import { createContext, type ReactNode, useContext } from "react";

import { useFitnessMessages } from "./messages";
import { useWorkoutProcessing } from "./use-workout-processing";

const ProcessingContext = createContext({ failed: false, pending: false });

export function WorkoutProcessing(props: {
	readonly workoutId?: string;
	readonly exerciseId?: string;
	readonly children: ReactNode;
}) {
	const processing = useWorkoutProcessing({
		workoutId: props.workoutId,
		exerciseId: props.exerciseId,
	});
	return (
		<ProcessingContext.Provider value={processing}>{props.children}</ProcessingContext.Provider>
	);
}

export function ProcessingNote() {
	const text = useFitnessMessages();
	const processing = useContext(ProcessingContext);
	if (!processing.failed && !processing.pending) {
		return null;
	}
	return (
		<span role="status" className="font-ui text-text-muted">
			{processing.failed ? text("client.processing.failed") : text("client.processing.pending")}
		</span>
	);
}
