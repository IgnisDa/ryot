import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { describe, expect, it } from "vitest";

import {
	canonicalManagedAssetRequest,
	savedViewRecordRequestKey,
	withSavedViewCursor,
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

	it("adds a cursor without changing the persisted query definition", () => {
		const queryDocument = buildSavedViewRecordDocument({ slug: "favorites" });
		const next = withSavedViewCursor(queryDocument, "cursor-2");
		const query = next.queries.savedView;

		expect(query.output.type).toBe("rows");
		if (query.output.type !== "rows") {
			return;
		}
		expect(query.output.pagination).toEqual({ limit: 1, after: "cursor-2" });
		expect(query.from).toEqual(queryDocument.queries.savedView.from);
		expect(query.where).toEqual(queryDocument.queries.savedView.where);
		expect(query.output.fields).toEqual(queryDocument.queries.savedView.output.fields);
		expect(queryDocument.queries.savedView.output.pagination).toEqual({ limit: 1 });
	});
});
