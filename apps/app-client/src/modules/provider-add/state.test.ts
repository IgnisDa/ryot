import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { mapProviderEntityLinks, mapProviderSummaries, providerAddError } from "./state";

const rows = (name: string, items: readonly unknown[]) => ({
	data: {
		[name]: { items, type: "rows", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
	},
});

const providerRow = {
	providerId: { kind: "text", value: "provider-1" },
	searchOptionsSchema: { kind: "null", value: null },
	providerSlug: { kind: "text", value: "openlibrary" },
	providerName: { kind: "text", value: "Open Library" },
	rootEntitySchemaSlug: { kind: "text", value: "book" },
};

const linkRow = {
	externalId: { kind: "text", value: "ext-1" },
};

describe("provider-add application state", () => {
	it("maps provider summaries through loading, transport failure, malformed, and ready", () => {
		expect(mapProviderSummaries(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapProviderSummaries(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(mapProviderSummaries(AsyncResult.success({ data: {} })).status).toBe("malformed");
		expect(
			mapProviderSummaries(AsyncResult.success(rows("providers", [providerRow]))),
		).toMatchObject({
			status: "ready",
			providers: [{ providerSlug: "openlibrary", searchOptionsSchema: null }],
		});
	});

	it("maps provider entity links into an external-id set", () => {
		expect(mapProviderEntityLinks(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapProviderEntityLinks(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(mapProviderEntityLinks(AsyncResult.success({ data: {} })).status).toBe("malformed");

		const ready = mapProviderEntityLinks(AsyncResult.success(rows("links", [linkRow])));
		expect(ready).toMatchObject({ status: "ready" });
		expect(ready.status === "ready" ? ready.externalIds.has("ext-1") : false).toBe(true);
	});

	it("keeps user-facing errors stable and free of internal causes", () => {
		const transport = providerAddError({ status: "transport-error" });
		const malformed = providerAddError({ status: "malformed" });

		expect(transport).toEqual(providerAddError({ status: "transport-error" }));
		expect(transport.title).not.toBe(malformed.title);
		expect(`${malformed.title}${malformed.detail}`).not.toContain("decode");
	});
});
