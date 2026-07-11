import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./metron.sandbox";

type MetronComicBookHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: MetronComicBookHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: (key) =>
			Promise.resolve({
				success: true as const,
				data: key === "comicBooks.metronUsername" ? "user" : "pass",
			}),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("comic-book.metron sandbox script", () => {
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

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
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
							scriptSlug: "comic-book-group.metron",
							relationshipProperties: { roles: ["Member"] },
						},
					],
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [{ name: "Saga #2", externalId: "2", scriptSlug: "comic-book.metron" }],
				},
			]);
			return undefined;
		});
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

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.name).toBe("Saga #5");
			const people = result.relatedEntityGroups?.find(
				(group) => group.relationshipSchemaSlug === "person-to-comic-book",
			);
			expect(people?.entities).toEqual([
				{
					name: "Jane Doe",
					externalId: "7",
					scriptSlug: "person.metron",
					relationshipProperties: { roles: ["Writer", "Artist"] },
				},
			]);
			return undefined;
		});
	});
});
