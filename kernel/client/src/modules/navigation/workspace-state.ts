import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
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
	rememberedPluginId: null | string,
): null | PluginClientCatalogEntry => {
	const visible = visibleWorkspaces(catalog);
	return visible.find(({ pluginId }) => pluginId === rememberedPluginId) ?? visible.at(0) ?? null;
};

export const preparedPageInstallationId = (prepared: PreparedClientPage) =>
	prepared.identity.kind === "plugin-page" || prepared.identity.kind === "plugin-saved-view"
		? prepared.identity.installationId
		: undefined;

export type WorkspaceTarget = Pick<PluginClientCatalogEntry, "pluginId" | "packageId">;

export const isWorkspaceRoot = (pathname: string, workspace: null | PluginClientCatalogEntry) => {
	if (workspace === null) {
		return false;
	}
	const root = pluginPath(workspace.packageId);
	return pathname === root || pathname === `${root}/`;
};
