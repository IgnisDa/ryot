import { createContext, type ReactNode, useContext } from "react";

import { useWorkoutProcessing } from "./use-workout-processing";

const ProcessingContext = createContext({ failed: false, pending: false, loading: false });

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

export function ComputedResults(props: {
	readonly compact?: boolean;
	readonly children: ReactNode;
}) {
	const processing = useContext(ProcessingContext);
	if (props.compact && (processing.failed || processing.pending)) {
		return processing.failed ? (
			<span className="text-text-muted">—</span>
		) : (
			<span
				aria-hidden="true"
				className="inline-block h-[1em] w-12 max-w-full rounded bg-surface-2 align-middle"
			/>
		);
	}
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
				{processing.loading ? "Checking calculated results…" : "Updating calculated results…"}
			</span>
		);
	}
	return props.children;
}

export const useComputedResultsStatus = () => useContext(ProcessingContext);
