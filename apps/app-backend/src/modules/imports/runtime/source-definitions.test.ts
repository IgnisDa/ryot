import { describe, expect, it } from "bun:test";

import { createImportRunBody } from "../schemas";
import {
	buildInputSummary,
	buildSourcePayload,
	getImportSourceFileInputs,
} from "./source-definitions";

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
				source: "movary",
				historyUploadToken: "tok_history",
				ratingsUploadToken: "tok_ratings",
				watchlistUploadToken: "tok_watchlist",
			}),
		).toEqual({
			source: "movary",
			historyUploadToken: "tok_history",
			ratingsUploadToken: "tok_ratings",
			watchlistUploadToken: "tok_watchlist",
		});

		expect(
			createImportRunBody.parse({
				source: "netflix",
				profileName: " Kids ",
				uploadToken: "tok_netflix",
			}),
		).toEqual({
			source: "netflix",
			profileName: "Kids",
			uploadToken: "tok_netflix",
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

	it("stores only safe Movary file metadata in the run summary", () => {
		const summary = buildInputSummary({
			historyUploadToken: "tok_history",
			ratingsUploadToken: "tok_ratings",
			source: "movary",
			watchlistUploadToken: "tok_watchlist",
		});

		expect(summary).toEqual({
			hasHistoryFile: true,
			hasRatingsFile: true,
			hasWatchlistFile: true,
			source: "movary",
		});
		expect(summary).not.toHaveProperty("historyUploadToken");
		expect(summary).not.toHaveProperty("ratingsUploadToken");
		expect(summary).not.toHaveProperty("watchlistUploadToken");
	});

	it("stores only safe Netflix import metadata in the run summary", () => {
		const summary = buildInputSummary({
			source: "netflix",
			profileName: "Kids",
			uploadToken: "tok_netflix",
		});

		expect(summary).toEqual({
			source: "netflix",
			hasExportFile: true,
			hasProfileName: true,
		});
		expect(summary).not.toHaveProperty("uploadToken");
		expect(summary).not.toHaveProperty("profileName");
	});
});

describe("getImportSourceFileInputs", () => {
	it("maps Movary upload tokens to the expected file payload keys", () => {
		const inputs = getImportSourceFileInputs({
			historyUploadToken: "tok_history",
			ratingsUploadToken: "tok_ratings",
			source: "movary",
			watchlistUploadToken: "tok_watchlist",
		});

		expect(inputs).toEqual([
			{
				bodyField: "historyUploadToken",
				payloadKey: "historyFilePath",
				required: undefined,
				allowedExtensions: ["csv"],
				uploadToken: "tok_history",
			},
			{
				bodyField: "ratingsUploadToken",
				payloadKey: "ratingsFilePath",
				required: undefined,
				allowedExtensions: ["csv"],
				uploadToken: "tok_ratings",
			},
			{
				bodyField: "watchlistUploadToken",
				payloadKey: "watchlistFilePath",
				required: undefined,
				allowedExtensions: ["csv"],
				uploadToken: "tok_watchlist",
			},
		]);
	});

	it("maps the Netflix upload token to the expected zip file input", () => {
		const inputs = getImportSourceFileInputs({
			source: "netflix",
			profileName: "Kids",
			uploadToken: "tok_netflix",
		});

		expect(inputs).toEqual([
			{
				required: undefined,
				payloadKey: undefined,
				bodyField: "uploadToken",
				allowedExtensions: ["zip"],
				uploadToken: "tok_netflix",
			},
		]);
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

	it("passes the trimmed Netflix profile name through the queued source payload only", () => {
		expect(
			buildSourcePayload({
				source: "netflix",
				profileName: " Kids ",
				uploadToken: "tok_netflix",
			}),
		).toEqual({ profileName: "Kids" });
	});
});
