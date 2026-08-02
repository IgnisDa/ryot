import type {
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot/contract/modules/saved-views/schemas";
import { Effect } from "effect";

import { appClient } from "./client";
import type { ApiScope } from "./request-key";

export const updateSavedView = (scope: ApiScope, viewSlug: string, payload: UpdateSavedViewBody) =>
	appClient(scope).request.pipe(
		Effect.flatMap((client) => client.savedViews.update({ params: { viewSlug }, payload })),
	);

export const reorderSavedViews = (scope: ApiScope, payload: ReorderSavedViewsBody) =>
	appClient(scope).request.pipe(Effect.flatMap((client) => client.savedViews.reorder({ payload })));
