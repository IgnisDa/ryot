import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { objectContaining } from "@ryot-app/testing/matchers";
import { describe, expect, it } from "vitest";

import { details, manifest, related } from "./shared";

type AnilistCompanyHost = Pick<ScriptHost, "httpCall">;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: AnilistCompanyHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.anilist sandbox script", () => {
	it.each([
		{},
		{ node: { type: "ANIME" } },
		{ node: { id: 0, type: "ANIME" } },
		{ node: { type: "ANIME", id: Number.MAX_SAFE_INTEGER + 1 } },
		{ node: { id: 2, type: "NOVEL" } },
	])("fails a malformed resumed terminal studio edge %#", (edge) => {
		const host = makeHost(() =>
			httpSuccess({
				data: { Studio: { media: { edges: [edge], pageInfo: { hasNextPage: false } } } },
			}),
		);
		return expect(
			Effect.runPromise(
				runSandboxTestScript(
					related,
					{
						externalId: "1",
						direction: "outgoing",
						continuation: { page: 2 },
						relationshipSchemaSlug: "company-to-anime",
					},
					host,
					execution,
				),
			),
		).rejects.toThrow("AniList studio inventory media edge is malformed");
	});
	it("completes an empty resumed terminal studio page", () => {
		const host = makeHost(() =>
			httpSuccess({ data: { Studio: { media: { edges: [], pageInfo: { hasNextPage: false } } } } }),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "1",
					direction: "outgoing",
					continuation: { page: 2 },
					relationshipSchemaSlug: "company-to-anime",
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ entities: [], coverage: { status: "complete" } });
				}),
			),
		);
	});
	it.each(["malformed", "failure"])(
		"fails a %s resumed studio page without publishing success",
		(kind) => {
			const host = makeHost(() =>
				kind === "failure"
					? Effect.fail({ message: "Studio page unavailable" })
					: httpSuccess({ data: { Studio: { media: { edges: [] } } } }),
			);
			return expect(
				Effect.runPromise(
					runSandboxTestScript(
						related,
						{
							externalId: "1",
							direction: "outgoing",
							continuation: { page: 2 },
							relationshipSchemaSlug: "company-to-anime",
						},
						host,
						execution,
					),
				),
			).rejects.toThrow(kind === "failure" ? "Studio page unavailable" : "connection is malformed");
		},
	);
	it("emits additive studio discoveries for each media type", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Studio: {
						id: 1,
						siteUrl: null,
						name: "Studio",
						media: {
							pageInfo: { hasNextPage: false },
							edges: [
								{ node: { id: 2, type: "ANIME", title: { userPreferred: "Anime" } } },
								{ node: { id: 2, type: "ANIME", title: { userPreferred: "Anime" } } },
								{ node: { id: 3, type: "MANGA", title: { userPreferred: "Manga" } } },
							],
						},
					},
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.properties).toEqual({
					images: [],
					alternateNames: [],
					sourceUrl: "https://anilist.co/studio/1",
				});
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "company-to-anime",
						entities: [
							{
								name: "Anime",
								externalId: "2",
								providerSlug: "anime.anilist",
								relationshipProperties: { roles: ["Animation Studio"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "company-to-manga",
						entities: [
							{
								name: "Manga",
								externalId: "3",
								providerSlug: "manga.anilist",
								relationshipProperties: { roles: ["Animation Studio"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("resumes three studio pages without recursively populating titles", () => {
		const requestedPages: number[] = [];

		const host = makeHost((_method, _url, options) => {
			const page = requestedPages.length + 1;
			expect(String(options?.body)).toContain(`"page":${page}`);
			requestedPages.push(page);
			return httpSuccess({
				data: {
					Studio: {
						id: 1,
						siteUrl: null,
						name: "Studio",
						media: {
							pageInfo: { hasNextPage: page < 3 },
							edges:
								page === 1
									? [{ node: { id: 2, type: "ANIME", title: { userPreferred: "Anime" } } }]
									: [{ node: { id: 3, type: "MANGA", title: { userPreferred: "Manga" } } }],
						},
					},
				},
			});
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.flatMap((result) => {
				expect(requestedPages).toEqual([1]);
				expect(result.relatedEntityGroups?.[0]).toEqual(
					objectContaining({
						entities: [objectContaining({ externalId: "2" })],
						coverage: { status: "more", continuation: { page: 2 } },
					}),
				);
				return runSandboxTestScript(
					related,
					{
						externalId: "1",
						direction: "outgoing",
						continuation: { page: 2 },
						relationshipSchemaSlug: "company-to-manga",
					},
					host,
					execution,
				);
			}),
			Effect.flatMap((result) => {
				expect(result.coverage).toEqual({ status: "more", continuation: { page: 3 } });
				return runSandboxTestScript(
					related,
					{
						externalId: "1",
						direction: "outgoing",
						continuation: { page: 3 },
						relationshipSchemaSlug: "company-to-manga",
					},
					host,
					execution,
				);
			}),
			Effect.map((result) => {
				expect(requestedPages).toEqual([1, 2, 3]);
				expect(result.coverage).toEqual({ status: "complete" });
				expect(result.entities).toEqual([objectContaining({ externalId: "3" })]);
			}),
			Effect.runPromise,
		);
	});
});
