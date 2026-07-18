import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./metron";
import details, { manifest as detailsManifest } from "./metron-details.sandbox";
import search, { manifest as searchManifest } from "./metron-search.sandbox";

type MetronComicBookHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: MetronComicBookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfigValue: (key) => Effect.succeed(key === "metronUsername" ? "user" : "pass"),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("comic-book.metron sandbox script", () => {
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
		]).toEqual([
			["comic-book.metron.search", "search"],
			["comic-book.metron.details", "details"],
		]);
	});
	it("loads Basic auth credentials and maps issue search results", () => {
		const configKeys: string[] = [];
		const host = defineSandboxTestHost(manifest, {
			getPluginConfigValue: (key) => {
				configKeys.push(key);
				return Effect.succeed(key === "metronUsername" ? "user" : "pass");
			},
			httpCall: (_method, url, options) => {
				const requestUrl = new URL(url);
				expect(requestUrl.host).toBe("metron.cloud");
				expect(requestUrl.pathname).toBe("/api/issue/");
				expect(options?.headers).toEqual({ Authorization: "Basic dXNlcjpwYXNz" });
				return httpSuccess({
					count: 1,
					results: [
						{
							id: 5,
							number: "1",
							cover_date: "2021-04-01",
							image: "https://img/m.jpg",
							series: { name: "My Series" },
						},
					],
				});
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ query: "series", page: 1, pageSize: 20 },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(configKeys).toEqual(["metronUsername", "metronPassword"]);
					expect(result).toMatchObject({
						details: { totalItems: 1, nextPage: null },
						items: [
							{
								externalId: "5",
								titleProperty: { kind: "text", value: "My Series #1" },
								primarySubtitleProperty: { kind: "number", value: 2021 },
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("keeps arc issues as related entities", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/issue/1/")) {
				return httpSuccess({
					id: 1,
					number: "1",
					credits: [],
					arcs: [{ id: 55 }],
					cover_date: "2024-01-01",
					series: { id: 10, name: "Saga" },
				});
			}
			return httpSuccess({
				results: [
					{ id: 1, number: "1", series: { name: "Saga" } },
					{ id: 2, number: "2", series: { name: "Saga" } },
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "person-to-comic-book",
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "comic-book-group-to-comic-book",
							entities: [
								{
									name: "Saga",
									externalId: "10",
									providerSlug: "comic-book-group.metron",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [{ name: "Saga #2", externalId: "2", providerSlug: "comic-book.metron" }],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("merges duplicate credit roles into one person entity", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/issue/1/")) {
				return httpSuccess({
					id: 1,
					number: "5",
					arcs: [],
					series: { id: 10, name: "Saga" },
					credits: [
						{ id: 7, creator: "Jane Doe", role: [{ name: "Writer" }] },
						{ id: 7, creator: "Jane Doe", role: [{ name: "Artist" }] },
					],
				});
			}
			return httpSuccess({ results: [] });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Saga #5");
					const people = result.relatedEntityGroups?.find(
						(group: { readonly relationshipSchemaSlug: string }) =>
							group.relationshipSchemaSlug === "person-to-comic-book",
					);
					expect(people?.entities).toEqual([
						{
							name: "Jane Doe",
							externalId: "7",
							providerSlug: "person.metron",
							relationshipProperties: { roles: ["Writer", "Artist"] },
						},
					]);
					return undefined;
				}),
			),
		);
	});
});
