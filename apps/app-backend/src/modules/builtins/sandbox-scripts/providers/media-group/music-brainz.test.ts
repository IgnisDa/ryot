import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./music-brainz.sandbox";

type MusicBrainzGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const httpFailure = () => Promise.resolve({ success: false as const, error: "not found" });

const makeHost = (route: (url: string) => unknown) =>
	defineSandboxTestHost(manifest, {
		httpCall: ((_method: string, url: string) => {
			const body = route(url);
			return body === null ? httpFailure() : httpSuccess(body);
		}) as MusicBrainzGroupHost["httpCall"],
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("music-group.music-brainz sandbox script", () => {
	it("maps release-group search hits and drops entries missing an id", () => {
		const host = makeHost(() => ({
			count: 1,
			"release-groups": [{ id: "g1", title: "Album One" }, { title: "No Id" }],
		}));

		return runSandboxTestDriver(
			search,
			{ query: "album", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "g1",
					calloutProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Album One" },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });
			return undefined;
		});
	});

	it("emits ordered track members from the chosen release's recordings", () => {
		const host = makeHost((url) => {
			if (url.includes("coverartarchive.org")) {
				return null;
			}
			if (url.includes("/release-group/")) {
				return {
					title: "Album One",
					"primary-type": "Album",
					"secondary-types": ["Live"],
					disambiguation: "deluxe",
				};
			}
			if (url.includes("/release?")) {
				return {
					releases: [
						{ id: "relB", status: "Official", date: "2005-01-01" },
						{ id: "relA", status: "Official", date: "2001-01-01" },
					],
				};
			}
			return {
				media: [
					{
						tracks: [
							{ recording: { id: "r1", title: "Track One" } },
							{ recording: { title: "Missing Id" } },
							{ recording: { id: "r3", title: "Track Three" } },
						],
					},
				],
			};
		});

		return runSandboxTestDriver(details, { externalId: "g1" }, host, execution).then((result) => {
			expect(result.name).toBe("Album One");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "music-group-to-music",
					entities: [
						{
							name: "Track One",
							externalId: "r1",
							scriptSlug: "music.music-brainz",
							relationshipProperties: { order: 1 },
						},
						{
							name: "Track Three",
							externalId: "r3",
							scriptSlug: "music.music-brainz",
							relationshipProperties: { order: 3 },
						},
					],
				},
			]);
			expect(result.properties).toEqual({
				parts: 3,
				images: [],
				description: "Album - Live - deluxe",
				sourceUrl: "https://musicbrainz.org/release-group/g1",
			});
			return undefined;
		});
	});
});
