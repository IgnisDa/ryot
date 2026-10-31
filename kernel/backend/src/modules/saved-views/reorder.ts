import {
	type SavedViewReference,
	savedViewReferenceKey,
} from "@ryot-app/contract/modules/plugins/references";
import {
	type ListedSavedView,
	SavedViewBadRequest,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { Effect } from "effect";

export type SavedViewReorderPlan = ReadonlyArray<
	SavedViewOrder & { readonly currentSortOrder: number }
>;

type SavedViewOrder = { readonly defaultSortOrder: null | number } & Pick<
	ListedSavedView,
	"isHidden" | "reference" | "sortOrder"
>;

export const buildSavedViewReorderPlan = Effect.fn(function* (
	views: ReadonlyArray<SavedViewOrder>,
	requested: ReadonlyArray<SavedViewReference>,
) {
	const invalid = (issue: "empty" | "duplicate" | "unknown-view") =>
		new SavedViewBadRequest({ reason: { issue, references: requested, code: "invalid-reorder" } });
	if (requested.length === 0) {
		return yield* invalid("empty");
	}
	const keys = new Set(requested.map(savedViewReferenceKey));
	if (keys.size !== requested.length) {
		return yield* invalid("duplicate");
	}
	const byKey = new Map(views.map((view) => [savedViewReferenceKey(view.reference), view]));
	const ordered = [];
	for (const reference of requested) {
		const view = byKey.get(savedViewReferenceKey(reference));
		if (!view) {
			return yield* invalid("unknown-view");
		}
		ordered.push(view);
	}
	ordered.push(...views.filter((view) => !keys.has(savedViewReferenceKey(view.reference))));
	return ordered.map((view, sortOrder) => ({
		sortOrder,
		isHidden: view.isHidden,
		reference: view.reference,
		currentSortOrder: view.sortOrder,
		defaultSortOrder: view.defaultSortOrder,
	}));
});
