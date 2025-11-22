import type { ApiGetResponseData } from "#/lib/api/types";

export type AppSavedView = ApiGetResponseData<"/saved-views">[number];

export type SavedViewQueryDefinition = AppSavedView["queryDefinition"];
