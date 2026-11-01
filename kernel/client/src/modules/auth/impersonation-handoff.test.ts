import { describe, expect, it } from "vitest";

import { parseImpersonationHandoff } from "#/modules/auth/impersonation-handoff";

describe("impersonation handoff", () => {
	it("reads one ticket and gives the path without its fragment", () => {
		expect(
			parseImpersonationHandoff("https://ryot.example/oauth/impersonate?from=admin#ticket=one-use"),
		).toEqual({ ticket: "one-use", url: "/oauth/impersonate?from=admin" });
	});

	it.each(["", "#ticket=", "#ticket=one&ticket=two", "#other=value"])(
		"rejects an invalid fragment: %s",
		(hash) => {
			expect(parseImpersonationHandoff(`https://ryot.example/oauth/impersonate${hash}`)).toEqual({
				ticket: null,
				url: "/oauth/impersonate",
			});
		},
	);
});
