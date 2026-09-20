import { pluginPath } from "@ryot-app/contract/modules/plugins/navigation";
import { PluginId } from "@ryot-app/contract/schema/brands";
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
			compareText(left.slug, right.slug) ||
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

export const resolvePluginRouteWorkspace = (
	catalog: PluginClientCatalog,
	pluginId: string,
): PluginClientCatalogEntry | null =>
	sortWorkspaces(catalog).find((plugin) => plugin.pluginId === pluginId) ?? null;

export const isWorkspaceRoot = (pathname: string, workspace: PluginClientCatalogEntry | null) =>
	workspace !== null &&
	(pathname === pluginPath(PluginId.make(workspace.pluginId)) ||
		pathname === `${pluginPath(PluginId.make(workspace.pluginId))}/`);
