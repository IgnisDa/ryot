import { describe, expect, it } from "vitest";

import { contractRequestOptions } from "./request-options";

describe("contract request options", () => {
	it("normalizes public requests without hidden credentials", () => {
		expect(contractRequestOptions({ serverUrl: " https://one.test/// " })).toEqual({
			headers: {},
			baseUrl: "https://one.test/api",
		});
	});

	it("includes the current cookie and extra headers for authenticated requests", () => {
		expect(
			contractRequestOptions({
				authenticated: true,
				authCookie: "session=one",
				serverUrl: "https://one.test/",
				headers: { "Admin-Access-Token": "admin" },
			}),
		).toEqual({
			baseUrl: "https://one.test/api",
			headers: { Cookie: "session=one", "Admin-Access-Token": "admin" },
		});
	});
});
