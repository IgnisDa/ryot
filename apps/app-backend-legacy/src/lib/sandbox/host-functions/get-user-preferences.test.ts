import { describe, expect, it } from "bun:test";

import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { defaultUserPreferences } from "~/modules/builtins";

import { createGetUserPreferencesHostFunction } from "./get-user-preferences";

const ctx = { userId: "user-1" };

const getUser1 = () =>
	Promise.resolve({ preferences: { ...defaultUserPreferences, isNsfw: true } });

const getUser2 = () =>
	Promise.resolve({ preferences: { languages: defaultUserPreferences.languages } });

// oxlint-disable-next-line unicorn/consistent-function-scoping
const getUser3 = () => Promise.resolve(undefined);

// oxlint-disable-next-line unicorn/consistent-function-scoping
const getUser4 = () => Promise.resolve(undefined);

// oxlint-disable-next-line unicorn/consistent-function-scoping
const getUser5 = () =>
	Promise.resolve({ preferences: { isNsfw: "not-a-boolean", languages: { providers: [] } } });

describe("getUserPreferences", () => {
	it("returns parsed preferences including isNsfw when explicitly set", async () => {
		const fn = createGetUserPreferencesHostFunction(getUser1);
		const result = await fn(ctx);
		expect(result).toEqual(apiSuccess({ ...defaultUserPreferences, isNsfw: true }));
	});

	it("defaults isNsfw to false when preferences stored without it", async () => {
		const fn = createGetUserPreferencesHostFunction(getUser2);
		const result = await fn(ctx);
		expect(result).toEqual(apiSuccess({ ...defaultUserPreferences, isNsfw: false }));
	});

	it("returns failure when user is not found", async () => {
		const fn = createGetUserPreferencesHostFunction(getUser3);
		expect(await fn(ctx)).toEqual(apiFailure("User not found"));
	});

	it("returns failure when userId is blank", async () => {
		const fn = createGetUserPreferencesHostFunction(getUser4);
		expect(await fn({ userId: "   " })).toEqual(
			apiFailure("getUserPreferences requires a non-empty userId in context"),
		);
	});

	it("returns failure when preferences fail schema validation", async () => {
		const fn = createGetUserPreferencesHostFunction(getUser5);
		expect(await fn(ctx)).toEqual(
			apiFailure("Invalid user preferences: Invalid input: expected boolean, received string"),
		);
	});
});
