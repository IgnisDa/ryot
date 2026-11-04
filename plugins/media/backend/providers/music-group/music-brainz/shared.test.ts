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
		httpCall: (_method, url) => {
			const body = route(url);
			return body === null ? Effect.fail({ message: "not found" }) : httpSuccess(body);
		},
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
const relatedInput = {
	externalId: "g1",
	direction: "outgoing" as const,
	relationshipSchemaSlug: "music-group-to-music",
};

describe("music-group.music-brainz sandbox script", () => {
	it("declares the canonical related entrypoint", () => {
		expect([relatedManifest.slug, relatedScript.operation]).toEqual([
			"music-group.music-brainz.related",
			"related",
		]);
	});

	it("maps release-group search hits and drops entries missing an id", () =>
		Effect.runPromise(
			runSandboxTestScript(
				search,
				{ page: 1, pageSize: 20, query: "album" },
				makeHost(() => ({
					count: 1,
					"release-groups": [{ id: "g1", title: "Album One" }, { title: "No Id" }],
				})),
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([{ externalId: "g1", title: "Album One" }]);
					expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				}),
			),
		));

	it("defers representative release selection and does not invent the part count", () => {
		const paths: string[] = [];
		const host = makeHost((url) => {
			const request = new URL(url);
			paths.push(request.pathname);
			if (request.hostname === "coverartarchive.org") {
				return null;
			}
			return {
				title: "Album One",
				"primary-type": "Album",
				"secondary-types": ["Live"],
				"artist-credit": [{ artist: { id: "a1", name: "Artist" } }],
			};
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "g1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(paths).toEqual(["/ws/2/release-group/g1", "/release-group/g1"]);
					expect(result.properties).toEqual({
						images: [],
						parts: null,
						description: "Album \\- Live",
						sourceUrl: "https://musicbrainz.org/release-group/g1",
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "music-group-to-music",
							coverage: { status: "more", continuation: { offset: 0, best: null, total: null } },
						},
						{
							direction: "incoming",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "person-to-music-group",
							entities: [
								{
									name: "Artist",
									externalId: "a1",
									providerSlug: "person.music-brainz",
									relationshipProperties: { roles: ["Artist"] },
								},
							],
						},
					]);
				}),
			),
		);
	});

	it("scans three variable-size release pages and keeps the original release preferences and track order", () => {
		const paths: string[] = [];
		const offsets: number[] = [];
		const host = makeHost((url) => {
			const request = new URL(url);
			paths.push(request.pathname);
			if (request.pathname === "/ws/2/release") {
				const offset = Number(request.searchParams.get("offset"));
				offsets.push(offset);
				expect(request.searchParams.get("limit")).toBe("100");
				return {
					"release-count": 4,
					"release-offset": offset,
					releases:
						offset === 0
							? [
									{ date: "1900", id: "bootleg", status: "Bootleg" },
									{ id: "undated", status: "Official" },
								]
							: [
									{
										status: "Official",
										id: offset === 2 ? "later" : "best",
										date: offset === 2 ? "2005" : "2001",
									},
								],
				};
			}
			expect(request.pathname).toBe("/ws/2/release/best");
			return {
				media: [
					{
						"track-count": 2,
						tracks: [
							{ recording: { id: "r1", title: "First" } },
							{ recording: { id: "r1", title: "Duplicate" } },
						],
					},
					{ "track-count": 1, tracks: [{ recording: { id: "r3", title: "Third" } }] },
				],
			};
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{ ...relatedInput, continuation: { offset: 0, best: null, total: null } },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(offsets).toEqual([0, 2, 3]);
					expect(paths).toEqual([
						"/ws/2/release",
						"/ws/2/release",
						"/ws/2/release",
						"/ws/2/release/best",
					]);
					expect(result).toEqual({
						coverage: { status: "complete" },
						entities: [
							{
								name: "First",
								externalId: "r1",
								providerSlug: "music.music-brainz",
								relationshipProperties: { order: 1 },
							},
							{
								name: "Third",
								externalId: "r3",
								providerSlug: "music.music-brainz",
								relationshipProperties: { order: 3 },
							},
						],
					});
				}),
			),
		);
	});

	it("continues across browse batches and retains the best release through completion", () => {
		const offsets: number[] = [];
		const host = makeHost((url) => {
			const request = new URL(url);
			if (request.pathname !== "/ws/2/release") {
				expect(request.pathname).toBe("/ws/2/release/r0");
				return { media: [{ tracks: [{ recording: { id: "track" } }] }] };
			}
			const offset = Number(request.searchParams.get("offset"));
			offsets.push(offset);
			return {
				"release-count": 23,
				releases: [
					{
						id: `r${offset}`,
						status: "Official",
						title: "x".repeat(5000),
						date: String(offset === 0 ? 1900 : 2050 + offset),
					},
				],
			};
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(
					related,
					{ ...relatedInput, continuation: { offset: 0, best: null, total: null } },
					host,
					execution,
				);
				assert(first.coverage.status === "more");
				expect(first.entities).toEqual([]);
				expect(offsets).toEqual(Array.from({ length: 10 }, (_, index) => index));
				expect(
					new TextEncoder().encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
							first.coverage.continuation,
						),
					).byteLength,
				).toBeLessThan(4096);
				expect(first.coverage.continuation).toEqual({
					total: 23,
					offset: 10,
					best: { id: "r0", official: true, date: -2208988800000 },
				});
				const second = yield* runSandboxTestScript(
					related,
					{ ...relatedInput, continuation: first.coverage.continuation },
					host,
					execution,
				);
				assert(second.coverage.status === "more");
				expect(offsets).toEqual(Array.from({ length: 20 }, (_, index) => index));
				expect(second.coverage.continuation).toEqual({
					total: 23,
					offset: 20,
					best: { id: "r0", official: true, date: -2208988800000 },
				});
				const last = yield* runSandboxTestScript(
					related,
					{ ...relatedInput, continuation: second.coverage.continuation },
					host,
					execution,
				);
				expect(offsets).toEqual(Array.from({ length: 23 }, (_, index) => index));
				expect(last.coverage).toEqual({ status: "complete" });
				expect(last.entities.map((entity) => entity.externalId)).toEqual(["track"]);
			}),
		);
	});

	it("does not stop at a short release page when the count is absent", () => {
		const offsets: number[] = [];
		const host = makeHost((url) => {
			const request = new URL(url);
			if (request.pathname !== "/ws/2/release") {
				return { media: [] };
			}
			const offset = Number(request.searchParams.get("offset"));
			offsets.push(offset);
			return { releases: offset < 2 ? [{ id: `r${offset}` }] : [] };
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{ ...relatedInput, continuation: { offset: 0, best: null, total: null } },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(offsets).toEqual([0, 1, 2]);
					expect(result.coverage).toEqual({ status: "complete" });
				}),
			),
		);
	});

	it.each([
		{ media: [{ "track-count": 2, tracks: [{ recording: { id: "r1" } }] }] },
		{ media: [{ tracks: [{ recording: { title: "No ID" } }] }] },
		{},
	])("fails instead of completing a malformed representative release", (release) => {
		const host = makeHost((url) =>
			new URL(url).pathname === "/ws/2/release"
				? { "release-count": 1, releases: [{ id: "best" }] }
				: release,
		);
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{ ...relatedInput, continuation: { offset: 0, best: null, total: null } },
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toContain("MusicBrainz release");
				}),
			),
		);
	});

	it("does not emit a provisional release when a middle browse page fails", () => {
		const paths: string[] = [];
		const host = makeHost((url) => {
			const request = new URL(url);
			paths.push(request.pathname);
			return Number(request.searchParams.get("offset")) === 1
				? null
				: { "release-count": 3, releases: [{ id: "provisional" }] };
		});
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{ ...relatedInput, continuation: { offset: 0, best: null, total: null } },
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toContain("not found");
					expect(paths).toEqual(["/ws/2/release", "/ws/2/release"]);
				}),
			),
		);
	});
});
