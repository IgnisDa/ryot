import { describe, expect, it } from "vitest";

import {
	PLUGIN_CLIENT_ASSET_MIME_TYPES,
	PLUGIN_CLIENT_FILE_EXTENSIONS,
	isPluginClientTextSource,
	pluginClientAssetMimeType,
	pluginClientFileExtension,
} from "./index";

describe("plugin client file policy", () => {
	it("defines supported lowercase extensions and asset MIME types", () => {
		expect(PLUGIN_CLIENT_FILE_EXTENSIONS).toEqual([
			".ts",
			".tsx",
			".css",
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
		]);
		expect(PLUGIN_CLIENT_ASSET_MIME_TYPES).toEqual({
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
		});
	});

	it("classifies text, assets, unsupported files, and uppercase extensions", () => {
		expect(isPluginClientTextSource("client/index.tsx")).toBe(true);
		expect(isPluginClientTextSource("client/logo.svg")).toBe(false);
		expect(pluginClientAssetMimeType("client/font.woff2")).toBe("font/woff2");
		expect(pluginClientAssetMimeType("client/index.ts")).toBeUndefined();
		expect(pluginClientFileExtension("client/logo.PNG")).toBeUndefined();
		expect(pluginClientFileExtension("client/index.js")).toBeUndefined();
	});
});
