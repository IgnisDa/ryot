import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type MetronPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: MetronPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(keys.map((key) => [key, key === "metronUsername" ? "user" : "pass"])),
			),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.metron sandbox script", () => {
	it("maps creator search hits and drops entries missing id or name", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 2,
				results: [
					{ id: 3, name: "Jane Doe", birth: "1980-05-01", image: "https://img/jane.jpg" },
					{ id: 4, name: "" },
				],
			}),
		);

		return runSandboxTestScript(
			search,
			{ page: 1, pageSize: 20, query: "jane" },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "3",
						metadata: [1980],
						title: "Jane Doe",
						imageUrl: "https://img/jane.jpg",
					},
				]);
				expect(result.details).toEqual({ totalItems: 2, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("maps creator details into person properties", () => {
		const host = makeHost(() =>
			httpSuccess({
				death: null,
				name: "Jane Doe",
				desc: "A creator.",
				birth: "1980-05-01",
				image: "https://img/jane.jpg",
			}),
		);

		return runSandboxTestScript(details, { externalId: "3" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Jane Doe");
				expect(result.properties).toEqual({
					deathDate: null,
					alternateNames: [],
					birthDate: "1980-05-01",
					description: "A creator.",
					sourceUrl: "https://metron.cloud/creator/3",
					images: [{ type: "remote", purpose: "profile", url: "https://img/jane.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
