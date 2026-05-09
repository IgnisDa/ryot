import type { ApiGetResponseData } from "~/lib/api/types";

export type AppSavedView = ApiGetResponseData<"/saved-views">[number];
export type AppEntitySavedView = AppSavedView;

export function isEntitySavedView(view: AppSavedView): view is AppEntitySavedView {
	return !("mode" in view.queryDefinition) || view.queryDefinition.mode === "entities";
}

export function sortSavedViewsByOrder(views: AppSavedView[]): AppSavedView[] {
	return views.toSorted((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		return a.name.localeCompare(b.name);
	});
}
