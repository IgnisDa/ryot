import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./audible.sandbox";

type AudibleGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: AudibleGroupHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("audiobook-group.audible sandbox script", () => {
	it("orders members by their sort field and numbers them sequentially", () => {
		const host = makeHost(() =>
			httpSuccess({
				product: {
					title: "The Series",
					relationships: [
						{ asin: "book-b", sort: "2" },
						{ asin: "book-a", sort: "1" },
						{ sort: "3" },
					],
				},
			}),
		);

		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "series-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Series");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "audiobook-group-to-audiobook",
							entities: [
								{
									externalId: "book-a",
									name: "Loading...",
									scriptSlug: "audiobook.audible",
									relationshipProperties: { order: 1 },
								},
								{
									externalId: "book-b",
									name: "Loading...",
									scriptSlug: "audiobook.audible",
									relationshipProperties: { order: 2 },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						parts: 2,
						images: [],
						description: null,
						sourceUrl: "https://www.audible.com/series/series-1/The Series",
					});
				}),
			),
		);
	});

	it("rejects group search", () => {
		const host = makeHost(() => httpSuccess({}));

		return expect(
			Effect.runPromise(
				runSandboxTestDriver(search, { query: "x", page: 1, pageSize: 20 }, host, execution),
			),
		).rejects.toThrow("Audible does not support audiobook group search");
	});
});
