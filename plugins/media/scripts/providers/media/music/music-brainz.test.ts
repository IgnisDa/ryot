import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./music-brainz.sandbox";

type MusicBrainzHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const httpFailure = () => Effect.fail(new Error("not found"));
const makeHost = (route: (url: string) => unknown) =>
	defineSandboxTestHost(manifest, {
		httpCall: ((_method: string, url: string) => {
			const body = route(url);
			return body === null ? httpFailure() : httpSuccess(body);
		}) as MusicBrainzHost["httpCall"],
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("music.music-brainz sandbox script", () => {
	it("maps recording search hits and drops entries missing an id", () => {
		const host = makeHost(() => ({
			count: 2,
			recordings: [
				{ id: "r1", title: "Song One", "first-release-date": "2001-05-01" },
				{ id: "", title: "Skip Empty" },
				{ title: "No Id" },
			],
		}));
		return Effect.runPromise(
			runSandboxTestDriver(search, { query: "song", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "r1",
							imageProperty: { kind: "null", value: null },
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Song One" },
							primarySubtitleProperty: { kind: "number", value: 2001 },
							secondarySubtitleProperty: { kind: "null", value: null },
						},
					]);
					expect(result.details).toEqual({ totalItems: 2, nextPage: null });
					return undefined;
				}),
			),
		);
	});
	it("groups artists and release-groups, computes duration and byVariousArtists", () => {
		const host = makeHost((url) => {
			if (url.includes("coverartarchive.org")) {
				return null;
			}
			return {
				length: 245000,
				title: "Song One",
				"first-release-date": "2001",
				"artist-credit": [
					{ artist: { id: "a1", name: "Artist One" } },
					{ artist: { id: "a2", name: "Artist Two" } },
				],
				releases: [
					{ id: "rel1", "release-group": { id: "g1", title: "Album One" } },
					{ id: "rel2", "release-group": { id: "g1", title: "Album One" } },
				],
			};
		});
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "r1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Song One");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-music",
							entities: [
								{
									externalId: "a1",
									name: "Artist One",
									scriptSlug: "person.music-brainz",
									relationshipProperties: { roles: ["Artist"] },
								},
								{
									externalId: "a2",
									name: "Artist Two",
									scriptSlug: "person.music-brainz",
									relationshipProperties: { roles: ["Artist"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									externalId: "g1",
									name: "Album One",
									scriptSlug: "music-group.music-brainz",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						genres: [],
						images: [],
						duration: 245,
						publishYear: 2001,
						byVariousArtists: true,
						sourceUrl: "https://musicbrainz.org/recording/r1",
					});
					return undefined;
				}),
			),
		);
	});
});
