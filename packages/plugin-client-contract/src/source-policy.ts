import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";

export const PLUGIN_CLIENT_ARTIFACT_CONTENT_TYPES = [
	"text/html; charset=utf-8",
	"text/css; charset=utf-8",
	"text/javascript; charset=utf-8",
	"image/png",
	"image/gif",
	"image/jpeg",
	"image/webp",
	"image/avif",
	"image/x-icon",
	"image/svg+xml",
	"font/woff2",
	"application/wasm",
] as const;

export const isPluginClientArtifactContentType = (contentType: string) =>
	PLUGIN_CLIENT_ARTIFACT_CONTENT_TYPES.some((supported) => supported === contentType);

export const PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"] as const;

export const PLUGIN_CLIENT_ASSET_EXTENSIONS = [
	".svg",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".ico",
	".woff2",
	".wasm",
] as const;

export type PluginClientAssetExtension = (typeof PLUGIN_CLIENT_ASSET_EXTENSIONS)[number];

export const PLUGIN_CLIENT_ASSET_MIME_TYPES = {
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".avif": "image/avif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
} as const satisfies Readonly<Record<PluginClientAssetExtension, string>>;

export const PLUGIN_CLIENT_FILE_EXTENSIONS = [
	...PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS,
	...PLUGIN_CLIENT_ASSET_EXTENSIONS,
] as const;

export type PluginClientTextSourceExtension = (typeof PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS)[number];
export type PluginClientFileExtension = (typeof PLUGIN_CLIENT_FILE_EXTENSIONS)[number];

export const pluginClientFileExtension = (path: string): PluginClientFileExtension | undefined =>
	PLUGIN_CLIENT_FILE_EXTENSIONS.find((extension) => path.endsWith(extension));

const isPluginTestSource = (path: string) =>
	path.slice(path.lastIndexOf("/") + 1).includes(".test.");

export const isPluginSourceFile = (path: string) =>
	!isPluginTestSource(path) &&
	((path.startsWith("backend/") && path.endsWith(".ts")) ||
		isPluginSharedSource(path) ||
		(path.startsWith("client/") && pluginClientFileExtension(path) !== undefined));

export const isPluginClientTextSource = (path: string) =>
	PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));

export const pluginClientAssetMimeType = (path: string) => {
	const extension = PLUGIN_CLIENT_ASSET_EXTENSIONS.find((ext) => path.endsWith(ext));
	return extension === undefined ? undefined : PLUGIN_CLIENT_ASSET_MIME_TYPES[extension];
};
