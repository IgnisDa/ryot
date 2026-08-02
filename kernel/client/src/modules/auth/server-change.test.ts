import { describe, expect, it } from "vitest";

import { changeServer } from "./server-change";

describe("server changes", () => {
	it.each([false, true])(
		"clears auth and server selection when sign-out failure is %s",
		async (fails) => {
			const calls: string[] = [];

			await changeServer({
				signOut: () => {
					calls.push("sign-out");
					return fails ? Promise.reject(new Error("offline")) : Promise.resolve();
				},
				clearAuth: () => calls.push("clear-auth"),
				clearServer: () => calls.push("clear-server"),
			});

			expect(calls).toEqual(["sign-out", "clear-auth", "clear-server"]);
		},
	);
});
