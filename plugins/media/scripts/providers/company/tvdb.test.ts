import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./tvdb";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Effect.succeed("Bearer test-token"),
		setCachedValue: () => Effect.succeed(null),
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "test-api-key"]))),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.tvdb sandbox script", () => {
	it("maps movies and series into outgoing authoritative groups", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					name: "Studio",
					movies: [{ id: 2, name: "Film" }, { tvdb_id: "4", title: "Sequel" }, { id: 6 }],
					series: [{ id: "3", name: "Show" }],
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-movie",
						entities: [
							{
								name: "Film",
								externalId: "2",
								providerSlug: "movie.tvdb",
								relationshipProperties: { roles: ["Company"] },
							},
							{
								name: "Sequel",
								externalId: "4",
								providerSlug: "movie.tvdb",
								relationshipProperties: { roles: ["Company"] },
							},
							{
								name: "Loading...",
								externalId: "6",
								providerSlug: "movie.tvdb",
								relationshipProperties: { roles: ["Company"] },
							},
						],
					},
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-show",
						entities: [
							{
								name: "Show",
								externalId: "3",
								providerSlug: "show.tvdb",
								relationshipProperties: { roles: ["Company"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("collects aliases from strings and name records, image and headquarters", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					name: "Studio",
					country: "United States",
					primaryImage: "https://img.example/logo.png",
					aliases: ["First", { name: "Second" }, { name: "   " }, { code: "x" }],
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Studio");
				expect(result.properties).toEqual({
					headquarters: "United States",
					alternateNames: ["First", "Second"],
					images: [{ type: "remote", url: "https://img.example/logo.png" }],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("throws when the company payload has no data", () => {
		const host = makeHost(() => httpSuccess({ data: null }));
		return expect(
			Effect.runPromise(runSandboxTestScript(details, { externalId: "1" }, host, execution)),
		).rejects.toThrow("TVDB returned no data for this company");
	});

	it("throws when the company has no name", () => {
		const host = makeHost(() => httpSuccess({ data: { movies: [] } }));
		return expect(
			Effect.runPromise(runSandboxTestScript(details, { externalId: "1" }, host, execution)),
		).rejects.toThrow("TVDB returned no name for this company");
	});

	it("throws for a non-numeric external id", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			Effect.runPromise(runSandboxTestScript(details, { externalId: "abc" }, host, execution)),
		).rejects.toThrow("externalId must be a numeric TVDB company ID");
	});

	it("searches companies and falls back to primaryImage for the image", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: [{ tvdb_id: "10", name: "Studio", primaryImage: "https://img.example/p.png" }],
				links: { total_items: 1, next: null },
			}),
		);

		return runSandboxTestScript(
			search,
			{ query: "studio", page: 1, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "10",
						titleProperty: { kind: "text", value: "Studio" },
						calloutProperty: { kind: "null", value: null },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
						imageProperty: {
							kind: "image",
							value: { type: "remote", url: "https://img.example/p.png" },
						},
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
