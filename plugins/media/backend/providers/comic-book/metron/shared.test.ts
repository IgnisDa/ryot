import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";

type MetronComicBookHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: MetronComicBookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(
				Object.fromEntries(keys.map((key) => [key, key === "metronUsername" ? "user" : "pass"])),
			),
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
			getPluginConfig: ({ required: keys = [] }) => {
				configKeys.push(...keys);
				return Effect.succeed(
					Object.fromEntries(keys.map((key) => [key, key === "metronUsername" ? "user" : "pass"])),
				);
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
				{ page: 1, pageSize: 20, query: "series" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(configKeys).toEqual(["metronUsername", "metronPassword"]);
					expect(result).toMatchObject({
						details: { totalItems: 1, nextPage: null },
						items: [{ externalId: "5", metadata: [2021], title: "My Series #1" }],
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
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "comic-book-to-genre",
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
					arcs: [],
					number: "5",
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
							externalId: "7",
							name: "Jane Doe",
							providerSlug: "person.metron",
							relationshipProperties: { roles: ["Writer", "Artist"] },
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("preserves first-seen people and case-sensitive role order across repeated credits", () => {
		const host = makeHost(() =>
			httpSuccess({
				credits: [
					{
						id: 8,
						creator: "First Person",
						role: [{ name: "Artist" }, { name: "Artist" }, { name: "Writer" }],
					},
					{ id: 7, creator: "Second Person", role: [{ name: "Editor" }] },
					{
						id: "8",
						creator: "Changed Name",
						role: [{ name: "Artist" }, { name: "writer" }, { name: "Colorist" }],
					},
					{ id: 7, creator: "Second Person", role: [{ name: "Editor" }] },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.relatedEntityGroups?.find(
							(group) => group.relationshipSchemaSlug === "person-to-comic-book",
						),
					).toEqual({
						direction: "incoming",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-comic-book",
						entities: [
							{
								externalId: "8",
								name: "First Person",
								providerSlug: "person.metron",
								relationshipProperties: { roles: ["Artist", "Writer", "writer", "Colorist"] },
							},
							{
								externalId: "7",
								name: "Second Person",
								providerSlug: "person.metron",
								relationshipProperties: { roles: ["Editor"] },
							},
						],
					});
				}),
			),
		);
	});
	it.each([
		["missing then named", [undefined, "Jane Doe"]],
		["named then missing", ["Jane Doe", undefined]],
	])("keeps the real name for duplicate Writer credits: %s", (_label, names) => {
		const host = makeHost(() =>
			httpSuccess({
				credits: names.map((creator) => ({ id: 7, creator, role: [{ name: "Writer" }] })),
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.relatedEntityGroups?.find(
							(group) => group.relationshipSchemaSlug === "person-to-comic-book",
						)?.entities,
					).toEqual([
						{
							externalId: "7",
							name: "Jane Doe",
							providerSlug: "person.metron",
							relationshipProperties: { roles: ["Writer"] },
						},
					]);
				}),
			),
		);
	});
	it("ignores malformed credits and merges Contributor fallback with parsed roles", () => {
		const host = makeHost(() =>
			httpSuccess({
				credits: [
					null,
					"invalid",
					{},
					{ id: null, creator: "No ID" },
					{ id: " ", creator: "Blank ID" },
					{ id: 7, role: [null, {}, { name: " " }, { name: 3 }] },
					{ id: 8, role: "Writer", creator: "Other Person" },
					{ id: 7, role: [], creator: " Jane Doe " },
					{ id: 7, creator: "Jane Doe", role: [{ name: " Writer " }, null] },
					{ id: 8, creator: "Other Person" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.relatedEntityGroups?.find(
							(group) => group.relationshipSchemaSlug === "person-to-comic-book",
						)?.entities,
					).toEqual([
						{
							externalId: "7",
							name: "Jane Doe",
							providerSlug: "person.metron",
							relationshipProperties: { roles: ["Contributor", "Writer"] },
						},
						{
							externalId: "8",
							name: "Other Person",
							providerSlug: "person.metron",
							relationshipProperties: { roles: ["Contributor"] },
						},
					]);
				}),
			),
		);
	});
	it.each([
		["empty", []],
		["missing", undefined],
		["non-array", {}],
		["invalid", [null, {}, { id: "" }]],
	])("clears authoritative people for %s credits", (_label, credits) => {
		const host = makeHost(() => httpSuccess({ credits }));
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.relatedEntityGroups?.find(
							(group) => group.relationshipSchemaSlug === "person-to-comic-book",
						),
					).toEqual({
						entities: [],
						direction: "incoming",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-comic-book",
					});
				}),
			),
		);
	});
});
