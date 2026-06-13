import { describe, expect, it } from "vitest";

import { decodeServerOrigin, resolveApiUrl } from "#/api/origin";
import {
	collectManagedAssets,
	managedAssetKey,
	resolveAssetUrl,
} from "#/modules/assets/managed-assets";

describe("managed assets", () => {
	it("deduplicates and orders only managed locators", () => {
		expect(
			collectManagedAssets([
				{ type: "s3", key: "z" },
				{ type: "remote", url: "https://images.example/cover.jpg" },
				undefined,
				{ type: "local", key: "a" },
				{ type: "s3", key: "z" },
			]),
		).toEqual([
			{ type: "local", key: "a" },
			{ type: "s3", key: "z" },
		]);
	});

	it("uses remote URLs directly and managed URLs by stable locator key", () => {
		const asset = { type: "local", key: "cover" } as const;
		const urls = new Map([[managedAssetKey(asset), "https://ryot.example/api/uploads/cover"]]);
		expect(resolveAssetUrl(asset, urls)).toBe("https://ryot.example/api/uploads/cover");
		expect(resolveAssetUrl({ type: "remote", url: "https://images.example/cover" }, urls)).toBe(
			"https://images.example/cover",
		);
	});

	it("resolves API-relative managed download paths", () => {
		const origin = decodeServerOrigin("https://ryot.example");
		expect(resolveApiUrl(origin, "/uploads/local/download?key=cover")).toBe(
			"https://ryot.example/api/uploads/local/download?key=cover",
		);
		expect(resolveApiUrl(origin, "https://assets.example/cover.jpg")).toBe(
			"https://assets.example/cover.jpg",
		);
	});
});
