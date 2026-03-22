import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { describe, expect, it } from "vitest";

import {
	canonicalManagedAssetRequest,
	savedViewRecordRequestKey,
	savedViewResultRequestKey,
} from "./atom-requests";

describe("saved-view atom requests", () => {
	it("partitions record requests by server, user, and slug", () => {
		const request = { slug: "favorites", userId: "user-1", serverUrl: "https://one.test" };
		const key = savedViewRecordRequestKey(request);

		expect(savedViewRecordRequestKey({ ...request })).toBe(key);
		expect(savedViewRecordRequestKey({ ...request, slug: "recent" })).not.toBe(key);
		expect(savedViewRecordRequestKey({ ...request, userId: "user-2" })).not.toBe(key);
		expect(savedViewRecordRequestKey({ ...request, serverUrl: "https://two.test" })).not.toBe(key);
	});

	it("canonicalizes query documents and partitions result requests", () => {
		const queryDocument = buildSavedViewRecordDocument({ slug: "favorites" });
		const request = { queryDocument, userId: "user-1", serverUrl: "https://one.test" };
		const key = savedViewResultRequestKey(request);

		expect(
			savedViewResultRequestKey({
				...request,
				queryDocument: { queries: { ...queryDocument.queries } },
			}),
		).toBe(key);
		expect(
			savedViewResultRequestKey({
				...request,
				queryDocument: buildSavedViewRecordDocument({ slug: "recent" }),
			}),
		).not.toBe(key);
		expect(savedViewResultRequestKey({ ...request, userId: "user-2" })).not.toBe(key);
		expect(savedViewResultRequestKey({ ...request, serverUrl: "https://two.test" })).not.toBe(key);
	});

	it("treats managed assets as a canonical set", () => {
		const local = { key: "cover.jpg", type: "local" } as const;
		const s3 = { key: "poster.jpg", type: "s3" } as const;
		const request = { userId: "user-1", assets: [local, s3], serverUrl: "https://one.test" };
		const canonical = canonicalManagedAssetRequest(request);

		expect(canonical.assets).toEqual([local, s3]);
		expect(canonicalManagedAssetRequest({ ...request, assets: [s3, local, s3] })).toEqual(
			canonical,
		);
		expect(canonicalManagedAssetRequest({ ...request, assets: [local] }).key).not.toBe(
			canonical.key,
		);
		expect(canonicalManagedAssetRequest({ ...request, userId: "user-2" }).key).not.toBe(
			canonical.key,
		);
		expect(
			canonicalManagedAssetRequest({ ...request, serverUrl: "https://two.test" }).key,
		).not.toBe(canonical.key);
	});
});
