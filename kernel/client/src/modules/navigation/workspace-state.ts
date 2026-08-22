import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";

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
	sortWorkspaces(catalog.filter(({ isDisabled }) => !isDisabled));

export const resolveRememberedWorkspace = (
	catalog: PluginClientCatalog,
	rememberedSlug: string | null,
): PluginClientCatalogEntry | null => {
	const visible = visibleWorkspaces(catalog);
	return visible.find(({ slug }) => slug === rememberedSlug) ?? visible.at(0) ?? null;
};

export const resolvePluginRouteWorkspace = (
	catalog: PluginClientCatalog,
	pluginSlug: string,
): PluginClientCatalogEntry | null =>
	sortWorkspaces(catalog).find(({ slug }) => slug === pluginSlug) ?? null;
