import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./anilist.sandbox";

type AnilistCompanyHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: AnilistCompanyHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.anilist sandbox script", () => {
	it("emits authoritative studio associations for each media type", () => {
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
								{ node: { id: 3, type: "MANGA", title: { userPreferred: "Manga" } } },
							],
						},
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.properties).toEqual({
				images: [],
				alternateNames: [],
				sourceUrl: "https://anilist.co/studio/1",
			});
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "company-to-anime",
					entities: [
						{
							name: "Anime",
							externalId: "2",
							scriptSlug: "anime.anilist",
							relationshipProperties: { roles: ["Animation Studio"] },
						},
					],
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "company-to-manga",
					entities: [
						{
							name: "Manga",
							externalId: "3",
							scriptSlug: "manga.anilist",
							relationshipProperties: { roles: ["Animation Studio"] },
						},
					],
				},
			]);
			return undefined;
		});
	});

	it("collects every studio media connection page", () => {
		const requestedPages: number[] = [];

		const host = makeHost((_method, _url, options) => {
			const page = requestedPages.length + 1;
			expect(String(options?.body)).toContain(`"page":${page}`);
			requestedPages.push(page);
			return httpSuccess({
				data: {
					Studio: {
						id: 1,
						name: "Studio",
						siteUrl: null,
						media: {
							pageInfo: { hasNextPage: page === 1 },
							edges:
								page === 1
									? [{ node: { id: 2, type: "ANIME", title: { userPreferred: "Anime" } } }]
									: [{ node: { id: 3, type: "MANGA", title: { userPreferred: "Manga" } } }],
						},
					},
				},
			});
		});

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(requestedPages).toEqual([1, 2]);
			expect(result.relatedEntityGroups).toEqual([
				expect.objectContaining({
					entities: [expect.objectContaining({ externalId: "2" })],
				}),
				expect.objectContaining({
					entities: [expect.objectContaining({ externalId: "3" })],
				}),
			]);
			return undefined;
		});
	});
});
