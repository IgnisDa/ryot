import type { ApiGetResponseData } from "~/lib/api/types";

export type AppSavedView = ApiGetResponseData<"/saved-views">[number];
export type AppEntitySavedView = Omit<AppSavedView, "queryDefinition"> & {
	queryDefinition: Extract<AppSavedView["queryDefinition"], { mode: "entities" }>;
};

export function isEntitySavedView(view: AppSavedView): view is AppEntitySavedView {
	return "mode" in view.queryDefinition;
}

export function sortSavedViewsByOrder(views: AppSavedView[]): AppSavedView[] {
	return [...views].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		return a.name.localeCompare(b.name);
	});
}
