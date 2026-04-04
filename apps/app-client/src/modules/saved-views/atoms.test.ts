import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/api/query-client", () => ({
	appQueryClient: {
		query: query.mockImplementation(() => Atom.make(0)),
		mutation: vi.fn(() => Atom.make(0)),
	},
}));
vi.mock("@/modules/server/storage", () => ({ serverStorageRuntime: Atom.runtime(Layer.empty) }));

import { managedAssetResolutionAtom, savedViewRecordAtom, savedViewResultAtom } from "./atoms";

describe("saved-view atom identity", () => {
	it("reuses record atoms for equal requests and isolates identity fields", () => {
		const request = { slug: "favorites", userId: "user-1", serverUrl: "https://one.test" };
		const atom = savedViewRecordAtom(request);

		expect(savedViewRecordAtom({ ...request })).toBe(atom);
		expect(savedViewRecordAtom({ ...request, slug: "recent" })).not.toBe(atom);
		expect(savedViewRecordAtom({ ...request, userId: "user-2" })).not.toBe(atom);
		expect(savedViewRecordAtom({ ...request, serverUrl: "https://two.test" })).not.toBe(atom);
		expect(query).toHaveBeenCalledWith("ryotql", "execute", {
			payload: buildSavedViewRecordDocument({ slug: "favorites" }),
		});
	});

	it("canonicalizes query documents and isolates result identity fields", () => {
		const queryDocument = buildSavedViewRecordDocument({ slug: "favorites" });
		const request = { queryDocument, userId: "user-1", serverUrl: "https://one.test" };
		const atom = savedViewResultAtom(request);
		const equivalentDocument = { queries: { ...queryDocument.queries } };

		expect(savedViewResultAtom({ ...request, queryDocument: equivalentDocument })).toBe(atom);
		expect(
			savedViewResultAtom({
				...request,
				queryDocument: buildSavedViewRecordDocument({ slug: "recent" }),
			}),
		).not.toBe(atom);
		expect(savedViewResultAtom({ ...request, userId: "user-2" })).not.toBe(atom);
		expect(savedViewResultAtom({ ...request, serverUrl: "https://two.test" })).not.toBe(atom);
	});

	it("treats managed assets as a canonical set", () => {
		const local = { key: "cover.jpg", type: "local" } as const;
		const s3 = { key: "poster.jpg", type: "s3" } as const;
		const request = { userId: "user-1", assets: [local, s3], serverUrl: "https://one.test" };
		const atom = managedAssetResolutionAtom(request);

		expect(managedAssetResolutionAtom({ ...request, assets: [s3, local, s3] })).toBe(atom);
		expect(managedAssetResolutionAtom({ ...request, assets: [local] })).not.toBe(atom);
		expect(managedAssetResolutionAtom({ ...request, userId: "user-2" })).not.toBe(atom);
		expect(managedAssetResolutionAtom({ ...request, serverUrl: "https://two.test" })).not.toBe(
			atom,
		);
		expect(query).toHaveBeenCalledWith("uploads", "resolveDownloads", {
			payload: { assets: [local, s3] },
		});
	});
});
