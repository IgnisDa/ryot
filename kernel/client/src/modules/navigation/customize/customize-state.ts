import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import type { NavigationData, NavigationView } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";

import { sortWorkspaces } from "#/modules/navigation/workspace-state";

export type CustomizeSection = "workspaces" | "views" | "savedViews";

export type CustomizeDraftItem = {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly isHidden: boolean;
};

export type CustomizeDraftViewItem = CustomizeDraftItem &
	Pick<NavigationView, "reference" | "pluginInstallationId">;
export type CustomizeDraftWorkspaceItem = CustomizeDraftItem &
	Pick<PluginClientCatalog[number], "pluginId" | "installationId">;

export type CustomizeDraft = {
	readonly views: readonly CustomizeDraftViewItem[];
	readonly workspaces: readonly CustomizeDraftWorkspaceItem[];
	readonly savedViews: readonly CustomizeDraftViewItem[];
};

const clampIndex = (index: number, length: number) =>
	Math.min(Math.max(index, 0), Math.max(length - 1, 0));

const draftItems = (items: readonly NavigationView[], installationId: string | null | undefined) =>
	[...items]
		.filter((item) => item.pluginInstallationId === installationId)
		.sort((left, right) => left.sortOrder - right.sortOrder)
		.map(({ icon, name, isHidden, reference, pluginInstallationId }) => ({
			icon,
			name,
			isHidden,
			reference,
			pluginInstallationId,
			id: identityTupleKey(reference),
		}));

const draftWorkspaces = (catalog: PluginClientCatalog) =>
	sortWorkspaces(catalog).map(
		({ icon, name, scope, isHidden, pluginId, packageId, installationId }) => ({
			icon,
			isHidden,
			pluginId,
			installationId,
			id: installationId,
			name: `${name} · ${scope === "system" ? "System" : "Private"} · ${packageId}`,
		}),
	);

const withVisibilityFlipped = <T extends CustomizeDraftItem>(item: T) => ({
	...item,
	isHidden: !item.isHidden,
});

const areSectionsEqual = (
	left: readonly CustomizeDraftItem[],
	right: readonly CustomizeDraftItem[],
) =>
	left.length === right.length &&
	left.every(
		(item, index) => item.id === right[index]?.id && item.isHidden === right[index]?.isHidden,
	);

export function initCustomizeDraft(props: {
	readonly data: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly workspaceInstallationId: string | undefined;
}): CustomizeDraft {
	return {
		workspaces: draftWorkspaces(props.catalog),
		savedViews: draftItems(props.data.savedViews, null),
		views: draftItems(props.data.savedViews, props.workspaceInstallationId),
	};
}

export function moveCustomizeItem(props: {
	readonly toIndex: number;
	readonly fromIndex: number;
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}): CustomizeDraft {
	const items = props.draft[props.section];
	if (items.length === 0) {
		return props.draft;
	}

	const fromIndex = clampIndex(props.fromIndex, items.length);
	const toIndex = clampIndex(props.toIndex, items.length);
	const item = items[fromIndex];
	if (fromIndex === toIndex) {
		return props.draft;
	}

	const next = [...items];
	next.splice(fromIndex, 1);
	next.splice(toIndex, 0, item);

	return { ...props.draft, [props.section]: next };
}

export function toggleCustomizeItem(props: {
	readonly id: string;
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}): CustomizeDraft {
	const items = props.draft[props.section];
	const item = items.find(({ id }) => id === props.id);
	if (item === undefined) {
		return props.draft;
	}
	if (
		props.section === "workspaces" &&
		!item.isHidden &&
		items.filter(({ isHidden }) => !isHidden).length === 1
	) {
		return props.draft;
	}

	return {
		...props.draft,
		[props.section]: items.map((sectionItem) =>
			sectionItem.id === props.id ? withVisibilityFlipped(sectionItem) : sectionItem,
		),
	};
}

export const isCustomizeDraftDirty = (props: {
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
}) =>
	!areSectionsEqual(props.draft.workspaces, props.initial.workspaces) ||
	!areSectionsEqual(props.draft.views, props.initial.views) ||
	!areSectionsEqual(props.draft.savedViews, props.initial.savedViews);

export function customizeSectionCounts(props: {
	readonly draft: CustomizeDraft;
	readonly section: CustomizeSection;
}) {
	const items = props.draft[props.section];
	const shown = items.filter((item) => !item.isHidden).length;
	const pinned = props.section === "views" ? 1 : 0;

	return { shown: shown + pinned, total: items.length + pinned };
}

export function customizeSearchSection(search: {
	readonly section?: unknown;
}): CustomizeSection | undefined {
	if (
		search.section === "workspaces" ||
		search.section === "views" ||
		search.section === "savedViews"
	) {
		return search.section;
	}
	return undefined;
}
