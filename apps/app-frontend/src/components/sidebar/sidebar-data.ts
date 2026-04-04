import type { AppSavedView } from "#/features/saved-views/model";
import { sortSavedViewsByOrder } from "#/features/saved-views/model";
import {
	type AppTracker,
	sortTrackersByOrder,
} from "#/features/trackers/model";
import type { SidebarTracker, SidebarView } from "./Sidebar.types";

export function toSidebarData(input: {
	views: AppSavedView[];
	trackers: AppTracker[];
}): {
	views: SidebarView[];
	trackers: SidebarTracker[];
} {
	const trackers = sortTrackersByOrder(input.trackers).map((tracker) => {
		const trackerViews = sortSavedViewsByOrder(
			input.views.filter((view) => view.trackerId === tracker.id),
		);

		return {
			id: tracker.id,
			name: tracker.name,
			slug: tracker.slug,
			icon: tracker.icon,
			sortOrder: tracker.sortOrder,
			isBuiltin: tracker.isBuiltin,
			isDisabled: tracker.isDisabled,
			accentColor: tracker.accentColor,
			views: trackerViews.map((view) => ({
				id: view.id,
				icon: view.icon,
				name: view.name,
				sortOrder: view.sortOrder,
				isBuiltin: view.isBuiltin,
				trackerId: view.trackerId,
				isDisabled: view.isDisabled,
				accentColor: view.accentColor,
			})),
		};
	});
	const views = sortSavedViewsByOrder(
		input.views.filter((view) => view.trackerId === null),
	).map((view) => ({
		id: view.id,
		icon: view.icon,
		name: view.name,
		sortOrder: view.sortOrder,
		isBuiltin: view.isBuiltin,
		trackerId: view.trackerId,
		isDisabled: view.isDisabled,
		accentColor: view.accentColor,
	}));

	return { views, trackers };
}
