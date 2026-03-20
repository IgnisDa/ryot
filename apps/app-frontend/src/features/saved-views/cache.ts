import { applyReorderPatch } from "#/lib/reorder";
import type { AppSavedView } from "./model";

export function applySavedViewReorderPatch(
	views: AppSavedView[],
	input: { viewIds: string[]; trackerId?: string },
): AppSavedView[] {
	const scopedViews = views.filter(
		(view) => view.trackerId === (input.trackerId ?? null),
	);
	const reorderedScopedViews = applyReorderPatch(scopedViews, input.viewIds);
	const reorderedScopedMap = new Map(
		reorderedScopedViews.map((view) => [view.id, view]),
	);

	return views.map((view) => reorderedScopedMap.get(view.id) ?? view);
}
