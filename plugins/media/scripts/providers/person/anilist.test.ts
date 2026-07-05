import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./anilist.sandbox";

type AnilistPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: AnilistPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.anilist sandbox script", () => {
	it("emits authoritative anime and manga credit groups", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Staff: {
						id: 1,
						gender: null,
						homeTown: null,
						dateOfBirth: {},
						dateOfDeath: {},
						description: null,
						image: { large: null },
						name: { full: "Creator" },
						characterMedia: {
							pageInfo: { hasNextPage: false },
							edges: [
								{
									characters: [{ name: { full: "Hero" } }],
									node: { id: 2, type: "ANIME", title: { userPreferred: "Anime Credit" } },
								},
							],
						},
						staffMedia: {
							pageInfo: { hasNextPage: false },
							edges: [
								{
									staffRole: "Writer",
									node: { id: 3, type: "MANGA", title: { userPreferred: "Manga Credit" } },
								},
							],
						},
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-anime",
						entities: [
							{
								externalId: "2",
								name: "Anime Credit",
								scriptSlug: "anime.anilist",
								relationshipProperties: { roles: ["Voicing (Hero)"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-manga",
						entities: [
							{
								externalId: "3",
								name: "Manga Credit",
								scriptSlug: "manga.anilist",
								relationshipProperties: { roles: ["Writer"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("collects every character and staff media page", () => {
		const requestedPages: number[] = [];

		const host = makeHost((_method, _url, options) => {
			const page = requestedPages.length + 1;
			expect(String(options?.body)).toContain(`"page":${page}`);
			requestedPages.push(page);
			return httpSuccess({
				data: {
					Staff: {
						id: 1,
						gender: null,
						homeTown: null,
						dateOfBirth: {},
						dateOfDeath: {},
						description: null,
						image: { large: null },
						name: { full: "Creator" },
						characterMedia: {
							pageInfo: { hasNextPage: page === 1 },
							edges:
								page === 1
									? [
											{
												characters: [{ name: { full: "Hero" } }],
												node: { id: 2, type: "ANIME", title: { userPreferred: "Anime Credit" } },
											},
										]
									: [],
						},
						staffMedia: {
							pageInfo: { hasNextPage: page === 1 },
							edges:
								page === 1
									? []
									: [
											{
												staffRole: "Writer",
												node: { id: 3, type: "MANGA", title: { userPreferred: "Manga Credit" } },
											},
										],
						},
					},
				},
			});
		});

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
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
			}),
			Effect.runPromise,
		);
	});

	it("formats fuzzy dates and cleans the biography HTML", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Staff: {
						id: 9,
						gender: "Male",
						homeTown: "Tokyo, Japan",
						name: { full: "Creator" },
						dateOfDeath: { year: 2020, month: 12 },
						description: "First line<br>Second line",
						image: { large: "https://img/creator.jpg" },
						dateOfBirth: { year: 1970, month: 2, day: 9 },
						staffMedia: { pageInfo: { hasNextPage: false }, edges: [] },
						characterMedia: { pageInfo: { hasNextPage: false }, edges: [] },
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "9" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Creator");
				expect(result.properties).toEqual({
					gender: "Male",
					deathDate: null,
					alternateNames: [],
					birthDate: "1970-02-09",
					birthPlace: "Tokyo, Japan",
					description: "First line\nSecond line",
					sourceUrl: "https://anilist.co/staff/9",
					images: [{ type: "remote", url: "https://img/creator.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
