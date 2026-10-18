import { createContext, useContext, type ReactNode } from "react";

import { useWorkoutProcessing } from "./use-workout-processing";

const ProcessingContext = createContext({ failed: false, pending: false });

export function WorkoutProcessing(props: {
	readonly exerciseId?: string;
	readonly workoutId?: string;
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

export function ComputedResults(props: { readonly children: ReactNode }) {
	const processing = useContext(ProcessingContext);
	if (processing.failed) {
		return (
			<span role="status" className="font-ui text-text-muted">
				Calculated results could not be updated.
			</span>
		);
	}
	if (processing.pending) {
		return (
			<span role="status" className="font-ui text-text-muted">
				Updating calculated results…
			</span>
		);
	}
	return props.children;
}

export const useComputedResultsStatus = () => useContext(ProcessingContext);
