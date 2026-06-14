import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./music-brainz.sandbox";

type MusicBrainzPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (route: (url: string) => unknown) =>
	defineSandboxTestHost(manifest, {
		httpCall: ((_method: string, url: string) =>
			httpSuccess(route(url))) as MusicBrainzPersonHost["httpCall"],
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.music-brainz sandbox script", () => {
	it("maps artist search hits and drops entries missing an id", () => {
		const host = makeHost(() => ({
			count: 1,
			artists: [{ id: "a1", name: "Artist One" }, { name: "No Id" }],
		}));

		return runSandboxTestDriver(
			search,
			{ query: "artist", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "a1",
					calloutProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Artist One" },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });
			return undefined;
		});
	});

	it("builds recordings and release-group relations with description and aliases", () => {
		const host = makeHost((url) => {
			if (url.includes("/recording?")) {
				return { recordings: [{ id: "r1", title: "Song One" }, { title: "No Id" }] };
			}
			return {
				name: "Artist One",
				type: "Group",
				country: "US",
				disambiguation: "the band",
				"life-span": { begin: "1990", end: "2005" },
				aliases: [{ name: "A1 Alias" }, { name: "Artist One" }],
				"release-groups": [{ id: "g1", title: "Album One" }],
			};
		});

		return runSandboxTestDriver(details, { externalId: "a1" }, host, execution).then((result) => {
			expect(result.name).toBe("Artist One");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music",
					entities: [
						{
							name: "Song One",
							externalId: "r1",
							scriptSlug: "music.music-brainz",
							relationshipProperties: { roles: ["Artist"] },
						},
					],
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-music-group",
					entities: [
						{
							name: "Album One",
							externalId: "g1",
							scriptSlug: "music-group.music-brainz",
							relationshipProperties: { roles: ["Artist"] },
						},
					],
				},
			]);
			expect(result.properties).toEqual({
				images: [],
				birthDate: "1990",
				deathDate: "2005",
				birthPlace: null,
				alternateNames: ["A1 Alias"],
				description: "Group - Country: US - Active: 1990 - 2005 - the band",
				sourceUrl: "https://musicbrainz.org/artist/a1",
			});
			return undefined;
		});
	});
});
