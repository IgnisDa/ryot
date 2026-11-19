export const PLUGIN_SHARED_FILE_EXTENSIONS = [".ts"] as const;

export type PluginSharedFileExtension = (typeof PLUGIN_SHARED_FILE_EXTENSIONS)[number];

export const pluginSharedFileExtension = (path: string): undefined | PluginSharedFileExtension =>
	PLUGIN_SHARED_FILE_EXTENSIONS.find((extension) => path.endsWith(extension));

export const isPluginSharedSource = (path: string) =>
	path.startsWith("shared/") && pluginSharedFileExtension(path) !== undefined;
