import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { UpdatePluginInstallationBody } from "@ryot-app/contract/modules/plugins/schemas";
import type {
	ReorderSavedViewsBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";

import type {
	CustomizeDraft,
	CustomizeDraftItem,
	CustomizeDraftViewItem,
	CustomizeSection,
} from "#/modules/shell/customize/customize-state";

export type CustomizeUpdate = {
	readonly reference: SavedViewReference;
	readonly payload: UpdateSavedViewBody;
};

export type CustomizePlan = {
	readonly updates: readonly CustomizeUpdate[];
	readonly reorders: readonly ReorderSavedViewsBody[];
	readonly workspaceUpdates: readonly CustomizeWorkspaceUpdate[];
};

export type CustomizeWorkspaceUpdate = {
	readonly installationId: string;
	readonly payload: UpdatePluginInstallationBody;
};

const sections = ["views", "savedViews"] as const satisfies readonly CustomizeSection[];

const hasOrderChanged = (
	draft: readonly CustomizeDraftItem[],
	initial: readonly CustomizeDraftItem[],
) => draft.length !== initial.length || draft.some((item, index) => item.id !== initial[index]?.id);

const updatePayload = (item: CustomizeDraftViewItem): UpdateSavedViewBody => ({
	isHidden: item.isHidden,
});

export function buildCustomizePlan(props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
	readonly workspaceInstallationId: string | undefined;
}): CustomizePlan {
	const updates: CustomizeUpdate[] = [];
	const reorders: ReorderSavedViewsBody[] = [];
	const workspaceUpdates: CustomizeWorkspaceUpdate[] = [];

	for (const section of sections) {
		for (const item of props.draft[section]) {
			const initial = props.initial[section].find((candidate) => candidate.id === item.id);
			if (initial?.isHidden !== item.isHidden) {
				updates.push({ reference: item.reference, payload: updatePayload(item) });
			}
		}
	}

	const workspaceOrderChanged = hasOrderChanged(props.draft.workspaces, props.initial.workspaces);
	for (const [sortOrder, item] of props.draft.workspaces.entries()) {
		const initial = props.initial.workspaces.find((candidate) => candidate.id === item.id);
		const visibilityChanged = initial !== undefined && initial.isHidden !== item.isHidden;
		if (workspaceOrderChanged) {
			workspaceUpdates.push({
				installationId: item.installationId,
				payload: { sortOrder, ...(visibilityChanged ? { isHidden: item.isHidden } : {}) },
			});
		} else if (visibilityChanged) {
			workspaceUpdates.push({
				installationId: item.installationId,
				payload: { isHidden: item.isHidden },
			});
		}
	}

	if (
		props.workspaceInstallationId !== undefined &&
		props.draft.views.length > 0 &&
		hasOrderChanged(props.draft.views, props.initial.views)
	) {
		reorders.push({
			installationId: props.workspaceInstallationId,
			references: props.draft.views.map((item) => item.reference),
		});
	}

	if (
		props.draft.savedViews.length > 0 &&
		hasOrderChanged(props.draft.savedViews, props.initial.savedViews)
	) {
		reorders.push({ references: props.draft.savedViews.map((item) => item.reference) });
	}

	return { updates, reorders, workspaceUpdates };
}
