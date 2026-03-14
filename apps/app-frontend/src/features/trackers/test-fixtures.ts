import type { CreateTrackerFormValues } from "./form";
import type { AppTracker } from "./model";

export function createTrackerFixture(
	overrides: Partial<AppTracker> = {},
): AppTracker {
	return {
		sortOrder: 1,
		name: "Tracker",
		slug: "tracker",
		enabled: true,
		id: "tracker-id",
		icon: "shapes",
		isBuiltin: false,
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
