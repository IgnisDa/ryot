import { describe, expect, it } from "bun:test";
import { apiFailure, apiSuccess } from "~/lib/sandbox/types";
import { defaultUserPreferences } from "~/modules/authentication";
import { createGetUserPreferencesHostFunction } from "./get-user-preferences";

const ctx = { userId: "user-1" };

describe("getUserPreferences", () => {
	it("returns parsed preferences including isNsfw when explicitly set", async () => {
		const getUser = async () => ({
			preferences: { ...defaultUserPreferences, isNsfw: true },
		});
		const fn = createGetUserPreferencesHostFunction(getUser);
		const result = await fn(ctx);
		expect(result).toEqual(
			apiSuccess({ ...defaultUserPreferences, isNsfw: true }),
		);
	});

	it("defaults isNsfw to false when preferences stored without it", async () => {
		const getUser = async () => ({
			preferences: { languages: defaultUserPreferences.languages },
		});
		const fn = createGetUserPreferencesHostFunction(getUser);
		const result = await fn(ctx);
		expect(result).toEqual(
			apiSuccess({ ...defaultUserPreferences, isNsfw: false }),
		);
	});

	it("returns failure when user is not found", async () => {
		const getUser = async () => undefined;
		const fn = createGetUserPreferencesHostFunction(getUser);
		expect(await fn(ctx)).toEqual(apiFailure("User not found"));
	});

	it("returns failure when userId is blank", async () => {
		const getUser = async () => undefined;
		const fn = createGetUserPreferencesHostFunction(getUser);
		expect(await fn({ userId: "   " })).toEqual(
			apiFailure("getUserPreferences requires a non-empty userId in context"),
		);
	});

	it("returns failure when preferences fail schema validation", async () => {
		const getUser = async () => ({
			preferences: { isNsfw: "not-a-boolean", languages: { providers: [] } },
		});
		const fn = createGetUserPreferencesHostFunction(getUser);
		expect(await fn(ctx)).toEqual(
			apiFailure(
				"Invalid user preferences: Invalid input: expected boolean, received string",
			),
		);
	});
});
