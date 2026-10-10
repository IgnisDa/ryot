import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";

const compareText = (left: string, right: string) => {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
};

export const sortWorkspaces = (catalog: PluginClientCatalog) =>
	[...catalog].sort(
		(left, right) =>
			left.sortOrder - right.sortOrder ||
			compareText(left.packageId, right.packageId) ||
			compareText(left.installationId, right.installationId),
	);

export const visibleWorkspaces = (catalog: PluginClientCatalog) =>
	sortWorkspaces(catalog.filter(({ health, isHidden }) => health === "ready" && !isHidden));

export const resolveRememberedWorkspace = (
	catalog: PluginClientCatalog,
	rememberedPluginId: string | null,
): PluginClientCatalogEntry | null => {
	const visible = visibleWorkspaces(catalog);
	return visible.find(({ pluginId }) => pluginId === rememberedPluginId) ?? visible.at(0) ?? null;
};

export const isWorkspaceRoot = (pathname: string, workspace: PluginClientCatalogEntry | null) =>
	workspace !== null &&
	(pathname === pluginPath(workspace.packageId) ||
		pathname === `${pluginPath(workspace.packageId)}/`);
