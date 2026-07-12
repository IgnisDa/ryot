import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./tvdb";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const httpMissing = () => Effect.fail({ message: "not found", details: { status: 404 } });

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Effect.succeed("Bearer test-token"),
		setCachedValue: () => Effect.succeed(null),
		getPluginConfigValue: () => Effect.succeed("test-api-key"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("movie-group.tvdb sandbox script", () => {
	it("rejects search", () =>
		expect(
			Effect.runPromise(
				runSandboxTestScript(
					search,
					{ query: "x", page: 1, pageSize: 20 },
					makeHost((_method, _url) => httpSuccess({})),
					execution,
				),
			),
		).rejects.toThrow("TVDB does not support movie group search"));

	it("sorts members by order, drops a numeric movieId while counting it, and trims fields", () => {
		const host = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({
					status: "success",
					data: {
						name: "My List",
						overview: "An overview",
						image: "  https://img/x.jpg  ",
						url: "  cool-list  ",
						entities: [
							{ movieId: "  10  ", name: "  Bravo  ", order: 2 },
							{ movieId: "20", name: "Alpha", order: 1 },
							{ movieId: 999, name: "Numeric", order: 3 },
							{ movieId: "30", order: 4 },
						],
					},
				});
			}
			return httpMissing();
		});

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "42" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "My List",
						properties: {
							parts: 4,
							images: [{ type: "remote", url: "https://img/x.jpg" }],
							sourceUrl: "https://thetvdb.com/lists/cool-list",
							description: "An overview",
						},
						relatedEntityGroups: [
							{
								direction: "outgoing",
								synchronization: "authoritative",
								relationshipSchemaSlug: "movie-group-to-movie",
								entities: [
									{
										name: "Alpha",
										externalId: "20",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 1 },
									},
									{
										name: "Bravo",
										externalId: "10",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 2 },
									},
									{
										name: "Loading...",
										externalId: "30",
										providerSlug: "movie.tvdb",
										relationshipProperties: { order: 4 },
									},
								],
							},
						],
					});
				}),
			),
		);
	});

	it("falls back to Unnamed List title and null sourceUrl, and overrides from translation", () => {
		const missingHost = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({ status: "success", data: { entities: [] } });
			}
			return httpMissing();
		});

		const translatedHost = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/extended")) {
				return httpSuccess({
					status: "success",
					data: { name: "Original", overview: "Original overview" },
				});
			}
			return httpSuccess({
				status: "success",
				data: { name: "Traducido", overview: "Descripción" },
			});
		});

		return Effect.runPromise(
			Effect.all(
				[
					runSandboxTestScript(details, { externalId: "7" }, missingHost, execution),
					runSandboxTestScript(details, { externalId: "8" }, translatedHost, execution),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(([missing, translated]) => {
					expect(missing.name).toBe("Unnamed List");
					expect(missing.properties).toEqual({
						parts: 0,
						images: [],
						sourceUrl: null,
						description: null,
					});
					expect(translated.name).toBe("Traducido");
					expect(translated.properties).toEqual({
						parts: 0,
						images: [],
						sourceUrl: null,
						description: "Descripción",
					});
				}),
			),
		);
	});

	it("translate prefers the primary translation record over the first entry", () => {
		const host = makeHost((_method, url) => {
			if (new URL(url).pathname.endsWith("/translations/spa")) {
				return httpSuccess({
					status: "success",
					data: [
						{ name: "First", overview: "First overview" },
						{ name: "Primary", overview: "Primary overview", isPrimary: true },
					],
				});
			}
			return httpMissing();
		});

		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ externalId: "9", language: "es", entitySchemaSlug: "movie-group" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "Primary",
						properties: { description: "Primary overview" },
					});
				}),
			),
		);
	});

	it("translate rejects a non-numeric externalId", () =>
		expect(
			Effect.runPromise(
				runSandboxTestScript(
					translate,
					{ externalId: "abc", language: "es", entitySchemaSlug: "movie-group" },
					makeHost((_method, _url) => httpSuccess({})),
					execution,
				),
			),
		).rejects.toThrow("externalId must be a numeric TVDB list ID"));
});
