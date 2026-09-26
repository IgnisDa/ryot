import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

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
						{ sort: "2", asin: "book-b" },
						{ sort: "1", asin: "book-a" },
						{ sort: "3" },
					],
				},
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "series-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Series");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "audiobook-group-to-audiobook",
							entities: [
								{
									name: "Loading...",
									externalId: "book-a",
									providerSlug: "audiobook.audible",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Loading...",
									externalId: "book-b",
									providerSlug: "audiobook.audible",
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
				runSandboxTestScript(search, { page: 1, query: "x", pageSize: 20 }, host, execution),
			),
		).rejects.toThrow("Audible does not support audiobook group search");
	});
});
