import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./hardcover";

type HardcoverBookGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: HardcoverBookGroupHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("hardcover-key"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("book-group.hardcover sandbox script", () => {
	it("maps series hits with book counts", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					search: {
						results: {
							found: 1,
							hits: [
								{
									document: {
										id: 100,
										books_count: 5,
										name: "The Series",
										image: { url: "https://img/s.jpg" },
									},
								},
								{ document: { id: 101 } },
							],
						},
					},
				},
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ query: "series", page: 1, pageSize: 20 },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "100",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "The Series" },
							primarySubtitleProperty: { kind: "number", value: 5 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/s.jpg" } },
						},
					]);
				}),
			),
		);
	});

	it("emits ordered book members preserving original positions", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					series_by_pk: {
						id: 100,
						books_count: 2,
						slug: "the-series",
						name: "The Series",
						description: "Series description.",
						book_series: [
							{ book: { id: 1, title: "First" } },
							{ book: { title: "Missing Id" } },
							{ book: { id: 3, title: "Third" } },
						],
					},
				},
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "100" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Series");
					expect(result.properties).toEqual({
						parts: 2,
						images: [],
						description: "Series description.",
						sourceUrl: "https://hardcover.app/series/the-series",
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "book-group-to-book",
							entities: [
								{
									name: "First",
									externalId: "1",
									providerSlug: "book.hardcover",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Third",
									externalId: "3",
									providerSlug: "book.hardcover",
									relationshipProperties: { order: 3 },
								},
							],
						},
					]);
				}),
			),
		);
	});
});
