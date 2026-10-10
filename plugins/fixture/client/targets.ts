export const FIXTURE_PLUGIN_SLUG = "fixture" as const;

export const fixtureRoute = (path: string, search?: Record<string, string>) => ({
	path,
	search,
	kind: "plugin-route" as const,
	pluginSlug: FIXTURE_PLUGIN_SLUG,
});
