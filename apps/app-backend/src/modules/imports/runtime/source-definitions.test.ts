import { describe, expect, it } from "bun:test";

import { createImportRunBody } from "../schemas";
import { buildInputSummary, buildSourcePayload } from "./source-definitions";

describe("createImportRunBody", () => {
	it("accepts the API-backed source payloads", () => {
		expect(
			createImportRunBody.parse({
				source: "plex",
				apiKey: "token_1",
				apiUrl: "https://plex.local:32400/library?token=secret",
			}),
		).toEqual({
			source: "plex",
			apiKey: "token_1",
			apiUrl: "https://plex.local:32400/library?token=secret",
		});

		expect(
			createImportRunBody.parse({
				password: "pw_1",
				username: "alice",
				source: "jellyfin",
				apiUrl: "https://jellyfin.local/base",
			}),
		).toEqual({
			password: "pw_1",
			username: "alice",
			source: "jellyfin",
			apiUrl: "https://jellyfin.local/base",
		});

		expect(
			createImportRunBody.parse({
				apiKey: "token_2",
				source: "media_tracker",
				apiUrl: "https://media.example.com/api/",
			}),
		).toEqual({
			apiKey: "token_2",
			source: "media_tracker",
			apiUrl: "https://media.example.com/api/",
		});

		expect(
			createImportRunBody.parse({
				apiKey: "token_3",
				source: "audiobookshelf",
				apiUrl: "https://books.example.com/root/",
			}),
		).toEqual({
			apiKey: "token_3",
			source: "audiobookshelf",
			apiUrl: "https://books.example.com/root/",
		});
	});
});

describe("buildInputSummary", () => {
	it("stores only safe host metadata for self-hosted API sources", () => {
		const summary = buildInputSummary({
			source: "plex",
			apiKey: "secret-token",
			allowInsecureConnections: true,
			apiUrl: "https://user:pw@plex.local:32400/library/sections?token=secret#fragment",
		});

		expect(summary).toEqual({
			source: "plex",
			host: "plex.local:32400",
			allowInsecureConnections: true,
		});
		expect(summary).not.toHaveProperty("apiKey");
		expect(summary).not.toHaveProperty("apiUrl");
	});

	it("does not persist Jellyfin usernames in the run summary", () => {
		const summary = buildInputSummary({
			password: "pw_1",
			username: "alice",
			source: "jellyfin",
			apiUrl: "https://jellyfin.local/base",
		});

		expect(summary).toEqual({ host: "jellyfin.local", source: "jellyfin" });
	});
});

describe("buildSourcePayload", () => {
	it("normalizes API source URLs before queueing jobs", () => {
		expect(
			buildSourcePayload({
				apiKey: "secret-token",
				source: "audiobookshelf",
				apiUrl: "https://books.example.com/root/?token=secret#fragment",
			}),
		).toEqual({ apiKey: "secret-token", apiUrl: "https://books.example.com/root" });
	});
});
