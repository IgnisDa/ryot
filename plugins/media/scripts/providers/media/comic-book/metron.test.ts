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
		getAppConfigValue: (key) =>
			Effect.succeed(key === "comicBooks.metronUsername" ? "user" : "pass"),
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
