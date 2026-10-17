import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { buildSearchPayload } from "#/modules/provider-add/search-controller";

const providerId = SandboxProviderId.make("provider-1");

describe("provider search payload", () => {
	it("omits the entire options property when no option values remain", () => {
		const input = { page: 2, providerId, query: "dune" };

		expect(buildSearchPayload({ ...input, options: {} })).toEqual({
			page: 2,
			providerId,
			pageSize: 20,
			query: "dune",
		});
		expect(Object.hasOwn(buildSearchPayload({ ...input }), "options")).toBe(false);
		expect(buildSearchPayload({ ...input, options: { region: "us" } }).options).toEqual({
			region: "us",
		});
	});
});
