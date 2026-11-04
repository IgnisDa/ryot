import { describe, expect, it } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { assert } from "@ryot-app/testing/assert";

import relatedScript, { manifest as relatedManifest } from "./related.sandbox";
import { details, manifest, related, search } from "./shared";

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (route: (url: string) => unknown) =>
	defineSandboxTestHost(manifest, {
		httpCall: (_method: string, url: string) => httpSuccess(route(url)),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.music-brainz sandbox script", () => {
	it("maps artist search hits and drops entries missing an id", () => {
		const host = makeHost(() => ({
			count: 1,
			artists: [{ id: "a1", name: "Artist One" }, { name: "No Id" }],
		}));

		return runSandboxTestScript(
			search,
			{ page: 1, pageSize: 20, query: "artist" },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([{ externalId: "a1", title: "Artist One" }]);
				expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("builds recordings and release-group relations with description and aliases", () => {
		const host = makeHost((url) => {
			if (url.includes("/recording?")) {
				return { "recording-count": 1, recordings: [{ id: "r1", title: "Song One" }] };
			}
			if (url.includes("/release-group?")) {
				return { "release-group-count": 1, "release-groups": [{ id: "g1", title: "Album One" }] };
			}
			return {
				type: "Group",
				country: "US",
				name: "Artist One",
				disambiguation: "the band",
				"life-span": { end: "2005", begin: "1990" },
				"release-groups": [{ id: "g1", title: "Album One" }],
				aliases: [{ name: "A1 Alias" }, { name: "Artist One" }],
			};
		});

		return runSandboxTestScript(details, { externalId: "a1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Artist One");
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-music",
						entities: [
							{
								name: "Song One",
								externalId: "r1",
								providerSlug: "music.music-brainz",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "additive",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "person-to-music-group",
						entities: [
							{
								externalId: "g1",
								name: "Album One",
								providerSlug: "music-group.music-brainz",
								relationshipProperties: { roles: ["Artist"] },
							},
						],
					},
				]);
				expect(result.properties).toEqual({
					images: [],
					birthPlace: null,
					birthDate: "1990",
					deathDate: "2005",
					alternateNames: ["A1 Alias"],
					sourceUrl: "https://musicbrainz.org/artist/a1",
					description: "Group \\- Country\\: US \\- Active\\: 1990 \\- 2005 \\- the band",
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("declares the canonical related entrypoint", () => {
		expect([relatedManifest.slug, relatedScript.operation]).toEqual([
			"person.music-brainz.related",
			"related",
		]);
	});

	it("uses browse counts for separate root continuations instead of embedded release groups", () => {
		const host = makeHost((url) => {
			const request = new URL(url);
			if (request.pathname === "/ws/2/recording") {
				return { "recording-count": 250, recordings: [{ id: "r1", title: "First" }] };
			}
			if (request.pathname === "/ws/2/release-group") {
				expect(request.searchParams.get("release-group-status")).toBe("all");
				return {
					"release-group-count": 10,
					"release-groups": [{ id: "g1", title: "First album" }],
				};
			}
			expect(request.searchParams.get("inc")).toBe("aliases");
			return { name: "Artist", "release-groups": [{ id: "embedded", title: "Truncated lookup" }] };
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "a1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.relatedEntityGroups?.map((group) => [
							group.coverage,
							group.entities.map((entity) => entity.externalId),
						]),
					).toEqual([
						[{ status: "more", continuation: { offset: 1, total: 250 } }, ["r1"]],
						[{ status: "more", continuation: { offset: 1, total: 10 } }, ["g1"]],
					]);
				}),
			),
		);
	});

	it.each([
		["person-to-music", "recording", "recordings"],
		["person-to-music-group", "release-group", "release-groups"],
	])(
		"pages %s through three browse pages without recursive population",
		(relationshipSchemaSlug, entity, key) => {
			const offsets: number[] = [];
			const host = makeHost((url) => {
				const request = new URL(url);
				expect(request.pathname).toBe(`/ws/2/${entity}`);
				expect(request.searchParams.get("limit")).toBe("100");
				const offset = Number(request.searchParams.get("offset"));
				offsets.push(offset);
				return {
					[`${entity}-count`]: 5,
					[`${entity}-offset`]: offset,
					[key]:
						offset === 1
							? [
									{ id: "r1", title: "One" },
									{ id: "r1", title: "Duplicate" },
								]
							: [{ title: "Later", id: `r${offset}` }],
				};
			});
			return Effect.runPromise(
				Effect.gen(function* () {
					const result = yield* runSandboxTestScript(
						related,
						{
							externalId: "a1",
							direction: "outgoing",
							relationshipSchemaSlug,
							continuation: { total: 5, offset: 1 },
						},
						host,
						execution,
					);
					expect(offsets).toEqual([1, 3, 4]);
					expect(result.coverage).toEqual({ status: "complete" });
					expect(result.entities.map((item) => item.externalId)).toEqual(["r1", "r3", "r4"]);
				}),
			);
		},
	);

	it("resumes a large inventory through terminal coverage without dropping source entities", () => {
		const host = makeHost((url) => {
			const offset = Number(new URL(url).searchParams.get("offset"));
			return {
				"recording-count": 23,
				"recording-offset": offset,
				recordings: [{ id: `r${offset}` }],
			};
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(
					related,
					{
						externalId: "a1",
						direction: "outgoing",
						continuation: { offset: 0, total: 23 },
						relationshipSchemaSlug: "person-to-music",
					},
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(first.entities).toHaveLength(10);
				expect(first.coverage.continuation).toEqual({ total: 23, offset: 10 });
				expect(
					new TextEncoder().encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
							first.coverage.continuation,
						),
					).byteLength,
				).toBeLessThan(4096);
				const second = yield* runSandboxTestScript(
					related,
					{
						externalId: "a1",
						direction: "outgoing",
						relationshipSchemaSlug: "person-to-music",
						continuation: first.coverage.continuation,
					},
					host,
					execution,
				);
				assert(second.coverage.status === "more");
				expect(second.entities).toHaveLength(10);
				expect(second.coverage.continuation).toEqual({ total: 23, offset: 20 });
				const last = yield* runSandboxTestScript(
					related,
					{
						externalId: "a1",
						direction: "outgoing",
						relationshipSchemaSlug: "person-to-music",
						continuation: second.coverage.continuation,
					},
					host,
					execution,
				);
				expect(last.entities.map((item) => item.externalId)).toEqual(["r20", "r21", "r22"]);
				expect(last.coverage).toEqual({ status: "complete" });
				expect(
					[...first.entities, ...second.entities, ...last.entities].map((item) => item.externalId),
				).toEqual(Array.from({ length: 23 }, (_, index) => `r${index}`));
			}),
		);
	});

	it.each([
		{},
		{ recordings: [] },
		{ recordings: [{ title: "No ID" }] },
		{ "recording-count": 8, recordings: [{ id: "r1" }] },
	])("does not accept an incomplete or inconsistent page", (page) => {
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "a1",
					direction: "outgoing",
					continuation: { total: 3, offset: 1 },
					relationshipSchemaSlug: "person-to-music",
				},
				makeHost(() => page),
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toContain("MusicBrainz");
				}),
			),
		);
	});

	it("fails the page batch if a later upstream call fails", () => {
		const seen: number[] = [];
		const host = defineSandboxTestHost(manifest, {
			httpCall: (_method, url) => {
				const offset = Number(new URL(url).searchParams.get("offset"));
				seen.push(offset);
				return offset === 2
					? Effect.fail({ message: "browse unavailable" })
					: httpSuccess({ "recording-count": 4, recordings: [{ id: `r${offset}` }] });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "a1",
					direction: "outgoing",
					continuation: { total: 4, offset: 0 },
					relationshipSchemaSlug: "person-to-music",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toContain("browse unavailable");
					expect(seen).toEqual([0, 1, 2]);
				}),
			),
		);
	});
});
