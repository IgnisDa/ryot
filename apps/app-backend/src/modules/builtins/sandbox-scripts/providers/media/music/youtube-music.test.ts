import { describe, expect, it } from "vitest";

import { type HostFunction, httpSuccess, runProviderDriver, toRecord } from "../../test-utils";
import youtubeMusicScriptCode from "./youtube-music.sandbox.js" with { type: "text" };

const runYoutubeMusicDetails = (
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
	testClient: unknown,
) =>
	runProviderDriver(youtubeMusicScriptCode, context, hostFunctions, {
		transformCode: (code) =>
			`${code}\ncreateYoutubeMusicClient = async () => __testYoutubeClient;\n`,
		extraBindings: { __testYoutubeClient: testClient },
	});

describe("music.youtube-music sandbox script", () => {
	it("keeps queue neighbors as related entities", () => {
		const testClient = {
			music: {
				getUpNext: () =>
					Promise.resolve({
						contents: [
							{
								title: "Source",
								video_id: "track-1",
								duration: { seconds: 180 },
								album: { id: "album-1", name: "Album", year: "2024" },
								artists: [{ channel_id: "artist-1", name: "Artist" }],
								thumbnail: [{ url: "https://img/1.jpg", width: 100, height: 100 }],
							},
							{ video_id: "track-2", title: "Pick One" },
							{ video_id: "track-2", title: "Pick One" },
							{ video_id: "track-3", title: "Pick Two" },
						],
					}),
			},
		};

		return runYoutubeMusicDetails(
			{ externalId: "track-1" },
			{ httpCall: () => httpSuccess({}) },
			testClient,
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntities).toEqual([
				{
					name: "Artist",
					externalId: "artist-1",
					scriptSlug: "person.youtube-music",
					relationshipProperties: { roles: ["Artist"] },
				},
				{
					name: "Album",
					externalId: "album-1",
					scriptSlug: "music-group.youtube-music",
					relationshipProperties: { roles: ["Member"] },
				},
				{
					name: "Pick One",
					externalId: "track-2",
					scriptSlug: "music.youtube-music",
					relationshipSchemaSlug: "media-suggestion",
				},
				{
					name: "Pick Two",
					externalId: "track-3",
					scriptSlug: "music.youtube-music",
					relationshipSchemaSlug: "media-suggestion",
				},
			]);
			return undefined;
		});
	});
});
