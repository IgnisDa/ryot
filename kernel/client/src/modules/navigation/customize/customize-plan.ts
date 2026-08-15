import type {
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";

import type {
	CustomizeDraft,
	CustomizeDraftItem,
	CustomizeSection,
} from "#/modules/navigation/customize/customize-state";

export type CustomizeUpdate = {
	readonly viewSlug: string;
	readonly payload: UpdateSavedViewBody;
};

export type CustomizePlan = {
	readonly updates: readonly CustomizeUpdate[];
	readonly reorders: readonly ReorderSavedViewsBody[];
};

const sections = ["views", "savedViews"] as const satisfies readonly CustomizeSection[];

const hasOrderChanged = (
	draft: readonly CustomizeDraftItem[],
	initial: readonly CustomizeDraftItem[],
) =>
	draft.length !== initial.length ||
	draft.some((item, index) => item.slug !== initial[index]?.slug);

const updatePayload = (item: CustomizeDraftItem): UpdateSavedViewBody => ({
	icon: item.icon,
	name: item.name,
	isDisabled: item.isDisabled,
	...(item.pluginSlug === null ? {} : { pluginSlug: PluginSlug.make(item.pluginSlug) }),
});

export function buildCustomizePlan(props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
	readonly workspaceSlug: string | undefined;
}): CustomizePlan {
	const updates: CustomizeUpdate[] = [];
	const reorders: ReorderSavedViewsBody[] = [];

	for (const section of sections) {
		for (const item of props.draft[section]) {
			const initial = props.initial[section].find((candidate) => candidate.slug === item.slug);
			if (initial?.isDisabled !== item.isDisabled) {
				updates.push({ viewSlug: item.slug, payload: updatePayload(item) });
			}
		}
	}

	if (
		props.workspaceSlug !== undefined &&
		props.draft.views.length > 0 &&
		hasOrderChanged(props.draft.views, props.initial.views)
	) {
		reorders.push({
			pluginSlug: PluginSlug.make(props.workspaceSlug),
			viewSlugs: props.draft.views.map((item) => item.slug),
		});
	}

	if (
		props.draft.savedViews.length > 0 &&
		hasOrderChanged(props.draft.savedViews, props.initial.savedViews)
	) {
		reorders.push({ viewSlugs: props.draft.savedViews.map((item) => item.slug) });
	}

	return { updates, reorders };
}
