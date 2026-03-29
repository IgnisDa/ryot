import type { ApiGetResponseData } from "#/lib/api/types";

export type AppSavedView = ApiGetResponseData<"/saved-views">[number];

export function sortSavedViewsByOrder(views: AppSavedView[]): AppSavedView[] {
	return [...views].sort((a, b) => {
		if (a.sortOrder !== b.sortOrder) {
			return a.sortOrder - b.sortOrder;
		}
		return a.name.localeCompare(b.name);
	});
}
