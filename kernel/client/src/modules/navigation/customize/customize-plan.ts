import type { UpdatePluginStateBody } from "@ryot-app/contract/modules/definitions/schemas";
import type {
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";

import type {
	CustomizeDraft,
	CustomizeDraftItem,
	CustomizeDraftViewItem,
	CustomizeSection,
} from "#/modules/navigation/customize/customize-state";

export type CustomizeUpdate = { readonly viewSlug: string; readonly payload: UpdateSavedViewBody };

export type CustomizePlan = {
	readonly updates: readonly CustomizeUpdate[];
	readonly reorders: readonly ReorderSavedViewsBody[];
	readonly workspaceUpdates: readonly CustomizeWorkspaceUpdate[];
};

export type CustomizeWorkspaceUpdate = {
	readonly pluginSlug: PluginSlug;
	readonly payload: UpdatePluginStateBody;
};

const sections = ["views", "savedViews"] as const satisfies readonly CustomizeSection[];

const hasOrderChanged = (
	draft: readonly CustomizeDraftItem[],
	initial: readonly CustomizeDraftItem[],
) =>
	draft.length !== initial.length ||
	draft.some((item, index) => item.slug !== initial[index]?.slug);

const updatePayload = (item: CustomizeDraftViewItem): UpdateSavedViewBody => ({
	icon: item.icon,
	name: item.name,
	isDisabled: item.isDisabled,
	...(item.pluginSlug === null ? {} : { workspacePluginSlug: PluginSlug.make(item.pluginSlug) }),
});

export function buildCustomizePlan(props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
	readonly workspaceSlug: string | undefined;
}): CustomizePlan {
	const updates: CustomizeUpdate[] = [];
	const reorders: ReorderSavedViewsBody[] = [];
	const workspaceUpdates: CustomizeWorkspaceUpdate[] = [];

	for (const section of sections) {
		for (const item of props.draft[section]) {
			const initial = props.initial[section].find((candidate) => candidate.slug === item.slug);
			if (initial?.isDisabled !== item.isDisabled) {
				updates.push({ viewSlug: item.slug, payload: updatePayload(item) });
			}
		}
	}

	const workspaceOrderChanged = hasOrderChanged(props.draft.workspaces, props.initial.workspaces);
	for (const [sortOrder, item] of props.draft.workspaces.entries()) {
		const initial = props.initial.workspaces.find((candidate) => candidate.slug === item.slug);
		const visibilityChanged = initial !== undefined && initial.isDisabled !== item.isDisabled;
		if (workspaceOrderChanged) {
			workspaceUpdates.push({
				pluginSlug: PluginSlug.make(item.slug),
				payload: { sortOrder, ...(visibilityChanged ? { isDisabled: item.isDisabled } : {}) },
			});
		} else if (visibilityChanged) {
			workspaceUpdates.push({
				pluginSlug: PluginSlug.make(item.slug),
				payload: { isDisabled: item.isDisabled },
			});
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

	return { updates, reorders, workspaceUpdates };
}
