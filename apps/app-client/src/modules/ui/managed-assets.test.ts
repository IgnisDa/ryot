import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import {
	canonicalManagedAssets,
	managedAssetKey,
	mapManagedAssetResolution,
	resolveAssetUrl,
	resolvedAssetUrls,
} from "./managed-assets";

const resolveUrl = (url: string) => url;
const s3 = { type: "s3", key: "poster.jpg" } as const;
const local = { type: "local", key: "cover.jpg" } as const;

describe("managed assets", () => {
	it("canonicalizes managed assets by type and key", () => {
		expect(managedAssetKey(local)).toBe("local:cover.jpg");
		expect(canonicalManagedAssets([s3, local, s3])).toEqual([local, s3]);
	});

	it("resolves remote and managed asset URLs", () => {
		const urls = new Map([
			[managedAssetKey(local), "https://server.test/api/uploads/local/cover.jpg"],
			[managedAssetKey(s3), "https://s3.test/poster.jpg"],
		]);
		const remote = { type: "remote", url: "https://images.test/remote.jpg" } as const;

		expect(resolveAssetUrl(remote, urls)).toBe(remote.url);
		expect(resolveAssetUrl(local, urls)).toBe(urls.get(managedAssetKey(local)));
		expect(resolveAssetUrl(s3, urls)).toBe(urls.get(managedAssetKey(s3)));
		expect(resolveAssetUrl({ type: "local", key: "missing.jpg" }, urls)).toBeUndefined();
	});

	it("maps download responses by managed asset key", () => {
		const urls = resolvedAssetUrls(
			[
				{ asset: local, downloadUrl: "uploads/local/cover.jpg" },
				{ asset: s3, downloadUrl: "https://s3.test/poster.jpg" },
			],
			(url) => url,
		);

		expect(urls).toEqual(
			new Map([
				["local:cover.jpg", "uploads/local/cover.jpg"],
				["s3:poster.jpg", "https://s3.test/poster.jpg"],
			]),
		);
	});

	it("keeps loading and failure non-fatal", () => {
		expect(mapManagedAssetResolution(AsyncResult.initial(), resolveUrl)).toEqual({
			urls: new Map(),
			status: "loading",
		});
		expect(
			mapManagedAssetResolution(AsyncResult.failure(Cause.fail("offline")), resolveUrl),
		).toMatchObject({ status: "unavailable", urls: new Map() });
		expect(
			mapManagedAssetResolution(
				AsyncResult.success([{ asset: local, downloadUrl: "cover.jpg" }]),
				resolveUrl,
			),
		).toEqual({ status: "ready", urls: new Map([["local:cover.jpg", "cover.jpg"]]) });
	});
});
