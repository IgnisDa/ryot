import { describe, expect, it } from "bun:test";

import { decodeOAuthTokenIdentity } from "#/modules/auth/token-identity";

const jwt = (claims: unknown) =>
	`header.${btoa(JSON.stringify(claims)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_")}.signature`;

describe("OAuth token identity", () => {
	it("decodes the token subject and session ID with the schema", () => {
		expect(decodeOAuthTokenIdentity(jwt({ sub: "user-1", sid: "session-1" }))).toEqual({
			sub: "user-1",
			sid: "session-1",
		});
		expect(decodeOAuthTokenIdentity("not-a-jwt")).toBeNull();
	});
});
