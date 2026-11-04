import { describe, expect, it } from "bun:test";

import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { objectContaining } from "@ryot-app/testing/matchers";

import { details, manifest, related } from "./shared";

type AnilistPersonHost = Pick<ScriptHost, "httpCall">;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: AnilistPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.anilist sandbox script", () => {
	it.each([
		{},
		{ node: { type: "ANIME" } },
		{ node: { id: 0, type: "ANIME" } },
		{ node: { type: "ANIME", id: Number.MAX_SAFE_INTEGER + 1 } },
		{ node: { id: 2, type: "NOVEL" } },
	])("fails a malformed resumed terminal staff edge %#", (edge) => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Staff: {
						staffMedia: { edges: [], pageInfo: { hasNextPage: false } },
						characterMedia: { edges: [edge], pageInfo: { hasNextPage: false } },
					},
				},
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
						relationshipSchemaSlug: "person-to-anime",
					},
					host,
					execution,
				),
			),
		).rejects.toThrow("AniList staff inventory media edge is malformed");
	});
	it("completes an empty resumed terminal staff page", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Staff: {
						staffMedia: { edges: [], pageInfo: { hasNextPage: false } },
						characterMedia: { edges: [], pageInfo: { hasNextPage: false } },
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "1",
					direction: "outgoing",
					continuation: { page: 2 },
					relationshipSchemaSlug: "person-to-anime",
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
		"fails a %s resumed staff page without publishing success",
		(kind) => {
			const host = makeHost(() =>
				kind === "failure"
					? Effect.fail({ message: "Staff page unavailable" })
					: httpSuccess({
							data: {
								Staff: {
									staffMedia: { edges: [] },
									characterMedia: { edges: [], pageInfo: { hasNextPage: false } },
								},
							},
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
							relationshipSchemaSlug: "person-to-anime",
						},
						host,
						execution,
					),
				),
			).rejects.toThrow(kind === "failure" ? "Staff page unavailable" : "connection is malformed");
		},
	);
	it("emits additive anime and manga credit discoveries", () => {
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
									node: { id: 2, type: "ANIME", title: { userPreferred: "Anime Credit" } },
									characters: [
										{ name: { full: "Hero" } },
										{ name: { full: "Villain" } },
										{ name: { full: "Hero" } },
									],
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
								{
									staffRole: "Illustrator",
									node: { id: 3, type: "MANGA", title: { userPreferred: "Manga Credit" } },
								},
							],
						},
					},
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-anime",
						entities: [
							{
								externalId: "2",
								name: "Anime Credit",
								providerSlug: "anime.anilist",
								relationshipProperties: { roles: ["Voicing"], character: "Hero / Villain" },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-manga",
						entities: [
							{
								externalId: "3",
								name: "Manga Credit",
								providerSlug: "manga.anilist",
								relationshipProperties: { roles: ["Writer", "Illustrator"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("resumes three character and staff media pages without recursive population", () => {
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
						staffMedia: {
							pageInfo: { hasNextPage: page < 3 },
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
						characterMedia: {
							pageInfo: { hasNextPage: page < 3 },
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
					},
				},
			});
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.flatMap((result) => {
				expect(requestedPages).toEqual([1]);
				expect(result.relatedEntityGroups?.[0]).toEqual<unknown>(
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
						relationshipSchemaSlug: "person-to-manga",
					},
					host,
					execution,
				);
			}),
			Effect.flatMap((result) => {
				expect(result).toEqual<unknown>({
					coverage: { status: "more", continuation: { page: 3 } },
					entities: [
						objectContaining({ externalId: "3", relationshipProperties: { roles: ["Writer"] } }),
					],
				});
				return runSandboxTestScript(
					related,
					{
						externalId: "1",
						direction: "outgoing",
						continuation: { page: 3 },
						relationshipSchemaSlug: "person-to-manga",
					},
					host,
					execution,
				);
			}),
			Effect.map((result) => {
				expect(requestedPages).toEqual([1, 2, 3]);
				expect(result.coverage).toEqual({ status: "complete" });
			}),
			Effect.runPromise,
		);
	});

	it("formats fuzzy dates and preserves biography line breaks", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Staff: {
						id: 9,
						gender: "Male",
						homeTown: "Tokyo, Japan",
						name: { full: "Creator" },
						dateOfDeath: { month: 12, year: 2020 },
						image: { large: "https://img/creator.jpg" },
						dateOfBirth: { day: 9, month: 2, year: 1970 },
						staffMedia: { edges: [], pageInfo: { hasNextPage: false } },
						characterMedia: { edges: [], pageInfo: { hasNextPage: false } },
						description: 'First line<br><span class="markdown_spoiler">Second line</span>',
					},
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "9" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Creator");
				expect(result.properties).toEqual({
					gender: "Male",
					deathDate: null,
					alternateNames: [],
					birthDate: "1970-02-09",
					birthPlace: "Tokyo, Japan",
					sourceUrl: "https://anilist.co/staff/9",
					description: "First line\\\n:spoiler[Second line]",
					images: [{ type: "remote", purpose: "profile", url: "https://img/creator.jpg" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
