import {
	runContract,
	type ContractProgram,
	type RunContractOptions,
} from "@ryot-app/contract/client";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeAdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";

const origin = decodeServerOrigin("https://ryot.example");

describe("admin API", () => {
	it("runs a typed contract program at the server API with only the admin token header", async () => {
		const requests: RunContractOptions[] = [];
		const api = makeAdminApi(
			<A, E>(program: ContractProgram<A, E>, options: RunContractOptions) => {
				requests.push(options);
				return runContract(program, options);
			},
		);

		await expect(
			Effect.runPromise(api.run(origin, "admin-secret", () => Effect.succeed("completed"))),
		).resolves.toBe("completed");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			baseUrl: "https://ryot.example/api",
			headers: { "Admin-Access-Token": "admin-secret" },
		});
		expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
	});

	it("wraps contract failures without exposing the token", async () => {
		const cause = new TypeError("offline");
		const api = makeAdminApi(() => Promise.reject(cause));
		const error = await Effect.runPromise(
			Effect.flip(api.run(origin, "admin-secret", () => Effect.void)),
		);

		expect(error.cause).toBe(cause);
		expect(String(error)).not.toContain("admin-secret");
	});
});
