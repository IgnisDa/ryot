import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type MusicBrainzPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

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
				return { recordings: [{ id: "r1", title: "Song One" }, { title: "No Id" }] };
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
						synchronization: "authoritative",
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
						synchronization: "authoritative",
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
					description: "Group - Country: US - Active: 1990 - 2005 - the band",
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
