import type {
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";

import type { CustomizeDraft, CustomizeDraftItem, CustomizeSection } from "./customize-state";

type CustomizeReorderRequest = { payload: ReorderSavedViewsBody };
type CustomizeUpdateRequest = { viewSlug: string; payload: UpdateSavedViewBody };
export type CustomizePlan = {
	updates: readonly CustomizeUpdateRequest[];
	reorders: readonly CustomizeReorderRequest[];
};

function hasOrderChanged(
	draft: readonly CustomizeDraftItem[],
	initial: readonly CustomizeDraftItem[],
) {
	return (
		draft.length !== initial.length ||
		draft.some((item, index) => item.slug !== initial[index]?.slug)
	);
}

function getUpdatePayload(item: CustomizeDraftItem) {
	return {
		icon: item.icon,
		name: item.name,
		isDisabled: item.isDisabled,
		...(item.pluginSlug === null ? {} : { pluginSlug: PluginSlug.make(item.pluginSlug) }),
	};
}

export function buildCustomizePlan(props: {
	draft: CustomizeDraft;
	workspaceSlug: string;
	initial: CustomizeDraft;
}) {
	const updates: CustomizeUpdateRequest[] = [];
	const reorders: CustomizeReorderRequest[] = [];

	for (const section of ["views", "savedViews"] as const satisfies readonly CustomizeSection[]) {
		for (const item of props.draft[section]) {
			const initialItem = props.initial[section].find((candidate) => candidate.slug === item.slug);
			if (initialItem?.isDisabled === item.isDisabled) {
				continue;
			}

			updates.push({ payload: getUpdatePayload(item), viewSlug: item.slug });
		}
	}

	if (props.draft.views.length > 0 && hasOrderChanged(props.draft.views, props.initial.views)) {
		reorders.push({
			payload: {
				pluginSlug: PluginSlug.make(props.workspaceSlug),
				viewSlugs: props.draft.views.map((item) => item.slug),
			},
		});
	}

	if (
		props.draft.savedViews.length > 0 &&
		hasOrderChanged(props.draft.savedViews, props.initial.savedViews)
	) {
		reorders.push({
			payload: { viewSlugs: props.draft.savedViews.map((item) => item.slug) },
		});
	}

	return { updates, reorders };
}
