import { describe, expect, it } from "vitest";

import {
	apiScopeKey,
	scopedReactivityKey,
	scopedRequestKey,
	serverRequestKey,
} from "./request-key";

describe("API request keys", () => {
	it("canonicalizes server origins", () => {
		expect(apiScopeKey({ serverUrl: " https://one.test/// ", userId: "user-1" })).toBe(
			apiScopeKey({ serverUrl: "https://one.test", userId: "user-1" }),
		);
		expect(serverRequestKey("https://one.test/")).toBe(serverRequestKey("https://one.test"));
	});

	it("partitions user and request identities", () => {
		const scope = { serverUrl: "https://one.test", userId: "user-1" };
		const key = scopedRequestKey(scope, "saved-view", "favorites");

		expect(scopedRequestKey(scope, "saved-view", "favorites")).toBe(key);
		expect(scopedRequestKey({ ...scope, userId: "user-2" }, "saved-view", "favorites")).not.toBe(
			key,
		);
		expect(
			scopedRequestKey({ ...scope, serverUrl: "https://two.test" }, "saved-view", "favorites"),
		).not.toBe(key);
		expect(scopedRequestKey(scope, "saved-view", "recent")).not.toBe(key);
	});

	it("uses one composite reactivity key per scope", () => {
		const scope = { serverUrl: "https://one.test", userId: "user-1" };

		expect(scopedReactivityKey("saved-views", scope)).toHaveLength(1);
		expect(scopedReactivityKey("saved-views", { ...scope, userId: "user-2" })).not.toEqual(
			scopedReactivityKey("saved-views", scope),
		);
	});
});
