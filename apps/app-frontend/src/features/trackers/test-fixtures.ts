import type { CreateTrackerFormValues } from "./form";
import type { AppTracker } from "./model";

export function createTrackerFixture(
	overrides: Partial<AppTracker> = {},
): AppTracker {
	return {
		sortOrder: 1,
		icon: "shapes",
		name: "Tracker",
		slug: "tracker",
		id: "tracker-id",
		isBuiltin: false,
		isDisabled: false,
		accentColor: "#5B7FFF",
		...overrides,
	};
}

export function createTrackerFormValuesFixture(
	overrides: Partial<CreateTrackerFormValues> = {},
): CreateTrackerFormValues {
	return {
		name: "Tracker",
		slug: "tracker",
		icon: "shapes",
		description: "",
		accentColor: "#5B7FFF",
		...overrides,
	};
}
