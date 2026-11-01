import type { MediaCreditFilterControls } from "../media/credits";

export const screenCreditFilters: MediaCreditFilterControls = {
	guest: "Guest credits",
	uncredited: "Uncredited credits",
	kind: {
		label: "Credit kind",
		choices: [
			{ value: "all", label: "All" },
			{ value: "cast", label: "Cast" },
			{ value: "crew", label: "Crew" },
		],
	},
};
