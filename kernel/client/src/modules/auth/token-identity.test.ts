import { describe, expect, it } from "vitest";

import {
	decodeOAuthTokenIdentity,
	handleOAuthSessionStorageEvent,
} from "#/modules/auth/token-identity";

const jwt = (claims: unknown) =>
	`header.${btoa(JSON.stringify(claims)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;

const tokenSet = (accessToken: string) =>
	JSON.stringify({
		accessToken,
		idToken: "id-token",
		tokenType: "Bearer",
		clientId: "ryot-web",
		refreshToken: "refresh",
		accessTokenExpiresAt: 1,
		scope: "openid ryot:api",
	});

describe("OAuth token identity", () => {
	it("decodes the token subject and session ID with the schema", () => {
		expect(decodeOAuthTokenIdentity(jwt({ sub: "user-1", sid: "session-1" }))).toEqual({
			sub: "user-1",
			sid: "session-1",
		});
		expect(decodeOAuthTokenIdentity("not-a-jwt")).toBeNull();
	});

	it("reloads only for the matching origin's identity, session, or presence transition", () => {
		const reloads: string[] = [];
		const reload = () => reloads.push("reload");
		const key = "ryot:oauth:tokens:https://ryot.example";
		const current = tokenSet(jwt({ sub: "user-1", sid: "session-1" }));

		handleOAuthSessionStorageEvent(
			{ key, oldValue: current, newValue: tokenSet(jwt({ sub: "user-1", sid: "session-1" })) },
			key,
			reload,
		);
		handleOAuthSessionStorageEvent(
			{ oldValue: current, key: `${key}:other`, newValue: tokenSet(jwt({ sub: "user-2" })) },
			key,
			reload,
		);
		expect(reloads).toEqual([]);

		handleOAuthSessionStorageEvent(
			{ key, oldValue: current, newValue: tokenSet(jwt({ sub: "user-2", sid: "session-2" })) },
			key,
			reload,
		);
		handleOAuthSessionStorageEvent(
			{ key, oldValue: current, newValue: tokenSet(jwt({ sub: "user-1", sid: "session-2" })) },
			key,
			reload,
		);
		handleOAuthSessionStorageEvent({ key, newValue: null, oldValue: current }, key, reload);
		expect(reloads).toHaveLength(3);
	});
});
