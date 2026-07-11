import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./vndb";

type VndbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: VndbHost["httpCall"]) => defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.vndb sandbox script", () => {
	it("maps producer search hits and drops entries missing an id or name", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 1,
				more: false,
				results: [{ id: "p1", name: "KID" }, { id: "p2", name: "" }, { name: "No Id" }],
			}),
		);

		return runSandboxTestScript(
			search,
			{ query: "kid", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "p1",
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "KID" },
						imageProperty: { kind: "null", value: null },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("maps producer details with cleaned aliases", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [
					{
						id: "p1",
						name: "KID",
						description: "A game developer.",
						aliases: ["Kindle Imagine Develop", "", "  "],
					},
				],
			}),
		);

		return runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("KID");
				expect(result.relatedEntityGroups).toBeUndefined();
				expect(result.properties).toEqual({
					images: [],
					description: "A game developer.",
					sourceUrl: "https://vndb.org/p1",
					alternateNames: ["Kindle Imagine Develop"],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("rejects an externalId that is not a VNDB producer id", async () => {
		const host = makeHost(() => httpSuccess({ results: [] }));
		try {
			await Effect.runPromise(
				runSandboxTestScript(details, { externalId: "v17" }, host, execution),
			);
			expect.unreachable("expected details to reject a non-producer externalId");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(Error);
		}
	});
});
