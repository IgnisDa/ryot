import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./tvdb";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Effect.succeed("Bearer test-token"),
		setCachedValue: () => Effect.succeed(null),
		getAppConfigValue: () => Effect.succeed("test-api-key"),
	});

const detailsHost = (person: unknown, translation: unknown = { data: {} }) =>
	makeHost((_method, url) =>
		new URL(url).pathname.includes("/translations")
			? httpSuccess(translation)
			: httpSuccess({ data: person }),
	);

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.tvdb sandbox script", () => {
	it("splits characters into outgoing authoritative movie and show groups", () => {
		const host = detailsHost({
			name: "Person Name",
			characters: [
				{ movieId: 10, movie: { name: "Film A" }, peopleType: "Actor" },
				{ movie_id: 10, people_type: "Director" },
				{ movieId: 10, peopleType: "Actor" },
				{ seriesId: 20, series: { name: "Show B" }, peopleType: "Writer" },
				{ series_id: 30 },
			],
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-movie",
						entities: [
							{
								name: "Film A",
								externalId: "10",
								providerSlug: "movie.tvdb",
								relationshipProperties: { roles: ["Actor", "Director"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-show",
						entities: [
							{
								name: "Show B",
								externalId: "20",
								providerSlug: "show.tvdb",
								relationshipProperties: { roles: ["Writer"] },
							},
							{
								name: "Loading...",
								externalId: "30",
								providerSlug: "show.tvdb",
								relationshipProperties: { roles: ["Actor"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("maps gender, biography description fallback, dates, and slug sourceUrl", () => {
		const host = detailsHost({
			name: "P",
			gender: 2,
			image: "http://img/1.jpg",
			slug: "john-doe",
			birth: "1980-01-01",
			death: "2020-01-01",
			birthPlace: "New York",
			biographies: [{ biography: "Bio text" }],
		});

		return runSandboxTestScript(details, { externalId: "5" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("P");
				expect(result.properties).toEqual({
					gender: "Female",
					alternateNames: [],
					birthPlace: "New York",
					birthDate: "1980-01-01",
					deathDate: "2020-01-01",
					description: "Bio text",
					images: [{ type: "remote", url: "http://img/1.jpg" }],
					sourceUrl: "https://www.thetvdb.com/people/john-doe",
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("falls back to id sourceUrl and null gender, honoring translation overrides", () => {
		const host = detailsHost(
			{ name: "P", gender: 99, biographies: [{ biography: "Bio" }] },
			{ data: { name: "Trans Name", overview: "Trans desc" } },
		);

		return runSandboxTestScript(details, { externalId: "5" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Trans Name");
				expect(result.properties).toMatchObject({
					gender: null,
					description: "Trans desc",
					birthDate: null,
					deathDate: null,
					birthPlace: null,
					sourceUrl: "https://www.thetvdb.com/people/5",
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("returns the primary translation name and description", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: [
					{ name: "First", overview: "First desc", isPrimary: false },
					{ name: "Primary", overview: "Primary desc", isPrimary: true },
				],
			}),
		);

		return runSandboxTestScript(
			translate,
			{ externalId: "5", language: "es", entitySchemaSlug: "person" },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result).toEqual({ name: "Primary", properties: { description: "Primary desc" } });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("rejects a non-numeric external id in translate", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			Effect.runPromise(
				runSandboxTestScript(
					translate,
					{ externalId: "abc", language: "es", entitySchemaSlug: "person" },
					host,
					execution,
				),
			),
		).rejects.toThrow("externalId must be a numeric TVDB person ID");
	});

	it("maps search results from tvdb_id and name only", () => {
		const host = makeHost(() =>
			httpSuccess({
				links: { total_items: 1 },
				data: [
					{ tvdb_id: "12345", name: "John Doe" },
					{ tvdb_id: "999", title: "Should Not Appear" },
				],
			}),
		);

		return runSandboxTestScript(
			search,
			{ query: "John", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "12345",
						titleProperty: { kind: "text", value: "John Doe" },
						calloutProperty: { kind: "null", value: null },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
						imageProperty: { kind: "null", value: null },
					},
				]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
