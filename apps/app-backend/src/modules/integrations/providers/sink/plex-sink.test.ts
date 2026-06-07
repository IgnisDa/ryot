import { describe, expect, it } from "bun:test";

import { parsePlexSink } from "./plex-sink";
import { makeSinkIntegration } from "./test-utils";

const buildMultipartPayload = (payload: unknown) => {
	const boundary = "----RyotBoundary";
	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		rawBody: `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`,
	};
};

describe("parsePlexSink", () => {
	it("parses multipart payloads and resolves TMDB ids from Plex GUIDs", async () => {
		const multipart = buildMultipartPayload({
			event: "media.pause",
			Account: { title: "alice" },
			Metadata: {
				type: "movie",
				duration: 200,
				viewOffset: 50,
				title: "Movie One",
				Guid: [{ id: "tmdb://101" }],
			},
		});

		const result = await parsePlexSink({
			rawBody: multipart.rawBody,
			contentType: multipart.contentType,
			integration: makeSinkIntegration({
				provider: "plex_sink",
				providerSpecifics: { kind: "plex_sink", username: "alice" },
			}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "101", scriptSlug: "movie.tmdb", entitySchemaSlug: "movie" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { consumedOn: "plex_sink", progressPercent: 25 },
				},
			],
		});
	});

	it("returns an empty result when the Plex username does not match", async () => {
		const multipart = buildMultipartPayload({
			event: "media.play",
			Account: { title: "bob" },
			Metadata: { type: "movie", duration: 200, viewOffset: 20, Guid: [{ id: "tmdb://101" }] },
		});

		const result = await parsePlexSink({
			rawBody: multipart.rawBody,
			contentType: multipart.contentType,
			integration: makeSinkIntegration({
				provider: "plex_sink",
				providerSpecifics: { kind: "plex_sink", username: "alice" },
			}),
		});

		expect(result).toEqual({ failures: [], entityGroups: [] });
	});

	it("ignores unsupported Plex event types", async () => {
		const multipart = buildMultipartPayload({
			event: "library.new",
			Account: { title: "alice" },
			Metadata: { type: "movie", duration: 200, viewOffset: 20, Guid: [{ id: "tmdb://101" }] },
		});

		const result = await parsePlexSink({
			rawBody: multipart.rawBody,
			contentType: multipart.contentType,
			integration: makeSinkIntegration({
				provider: "plex_sink",
				providerSpecifics: { kind: "plex_sink" },
			}),
		});

		expect(result).toEqual({ failures: [], entityGroups: [] });
	});

	it("returns an input_transformation failure when multipart parsing fails", async () => {
		const result = await parsePlexSink({
			rawBody: "{}",
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "plex_sink",
				providerSpecifics: { kind: "plex_sink" },
			}),
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Plex webhook payload",
			},
		]);
	});
});
