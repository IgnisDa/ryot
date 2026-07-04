import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./metron.sandbox";

type MetronGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: MetronGroupHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: (key) =>
			Promise.resolve({
				success: true as const,
				data: key === "comicBooks.metronUsername" ? "user" : "pass",
			}),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("comic-book-group.metron sandbox script", () => {
	it("maps series search hits, using issue_count as the parts subtitle", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 1,
				next: null,
				results: [
					{ id: 10, name: "Saga", issue_count: 60 },
					{ id: 11, name: "" },
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "saga", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "10",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Saga" },
					primarySubtitleProperty: { kind: "number", value: 60 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });
			return undefined;
		});
	});

	it("sets nextPage when the payload reports a next link", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 100,
				next: "https://metron.cloud/api/series/?page=2",
				results: [{ id: 10, name: "Saga", issue_count: 60 }],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "saga", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.details).toEqual({ totalItems: 100, nextPage: 2 });
			return undefined;
		});
	});

	it("maps series details and orders member issues", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/issue_list/")) {
				return httpSuccess({
					results: [{ id: 1, issue: "Saga #1" }, { id: 2, issue_name: "Saga #2" }, { id: 3 }],
				});
			}
			return httpSuccess({ name: "Saga", desc: "A comic.", issue_count: 3 });
		});

		return runSandboxTestDriver(details, { externalId: "10" }, host, execution).then((result) => {
			expect(result.name).toBe("Saga");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "comic-book-group-to-comic-book",
					entities: [
						{
							name: "Saga #1",
							externalId: "1",
							scriptSlug: "comic-book.metron",
							relationshipProperties: { order: 1 },
						},
						{
							name: "Saga #2",
							externalId: "2",
							scriptSlug: "comic-book.metron",
							relationshipProperties: { order: 2 },
						},
						{
							name: "Loading...",
							externalId: "3",
							scriptSlug: "comic-book.metron",
							relationshipProperties: { order: 3 },
						},
					],
				},
			]);
			expect(result.properties).toEqual({
				parts: 3,
				images: [],
				description: "A comic.",
				sourceUrl: "https://metron.cloud/series/10",
			});
			return undefined;
		});
	});
});
