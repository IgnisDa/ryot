import type { WorkoutSetLot } from "../shared/workout-set";

type SetLotPresentation = {
	readonly name: string;
	readonly label: string;
	readonly pill: string;
	readonly tag: string | undefined;
	readonly tone: string | undefined;
};

export const setLots: Record<WorkoutSetLot, SetLotPresentation> = {
	drop: {
		tag: "D",
		label: "Drop",
		name: "Drop set",
		tone: "text-info",
		pill: "border-border bg-surface-2 text-text",
	},
	failure: {
		tag: "F",
		label: "Failure",
		tone: "text-danger",
		name: "Set to failure",
		pill: "border-danger text-danger",
	},
	normal: {
		tag: undefined,
		tone: undefined,
		label: "Normal",
		name: "Working set",
		pill: "border-border bg-surface-2 text-text",
	},
	warm_up: {
		tag: "W",
		label: "Warm-up",
		name: "Warm-up set",
		tone: "text-warning",
		pill: "border-dashed border-border-strong text-text-muted",
	},
};

export const setLabels = (lots: readonly (WorkoutSetLot | null | undefined)[]) => {
	let working = 0;
	return lots.map((lot) => {
		const tag = setLots[lot ?? "normal"].tag;
		if (tag !== undefined) {
			return tag;
		}
		working += 1;
		return String(working);
	});
};
