import type { WorkoutSetLot } from "../shared/workout-set";
import type { FitnessText } from "./messages";

type SetLotPresentation = {
	readonly pill: string;
	readonly tag: string | undefined;
	readonly tone: string | undefined;
};

export const setLots: Record<WorkoutSetLot, SetLotPresentation> = {
	failure: { tag: "F", tone: "text-danger", pill: "border-danger text-danger" },
	drop: { tag: "D", tone: "text-info", pill: "border-border bg-surface-2 text-text" },
	normal: { tag: undefined, tone: undefined, pill: "border-border bg-surface-2 text-text" },
	warm_up: {
		tag: "W",
		tone: "text-warning",
		pill: "border-dashed border-border-strong text-text-muted",
	},
};

export const setLotLabel = (text: FitnessText, lot: WorkoutSetLot) =>
	text("client.set-lot.label", { lot });

export const setLotName = (text: FitnessText, lot: WorkoutSetLot) =>
	text("client.set-lot.name", { lot });

export const setLabels = (lots: readonly (null | undefined | WorkoutSetLot)[]) => {
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
