import type { AppSavedView } from "./model";

export function applySavedViewReorderPatch(
	views: AppSavedView[],
	input: { viewSlugs: string[]; trackerId?: string },
): AppSavedView[] {
	const scopedViews = views.filter((view) => view.trackerId === (input.trackerId ?? null));

	const slugToView = new Map(scopedViews.map((view) => [view.slug, view]));
	const reordered: AppSavedView[] = [];
	const seen = new Set<string>();

	for (const slug of input.viewSlugs) {
		const view = slugToView.get(slug);
		if (view) {
			reordered.push(view);
			seen.add(view.slug);
		}
	}

	for (const view of scopedViews) {
		if (!seen.has(view.slug)) {
			reordered.push(view);
		}
	}

	const reorderedWithOrder = reordered.map((view, index) => Object.assign(view, { sortOrder: index + 1 }));

	const reorderedMap = new Map(reorderedWithOrder.map((view) => [view.slug, view]));

	return views.map((view) => reorderedMap.get(view.slug) ?? view);
}
