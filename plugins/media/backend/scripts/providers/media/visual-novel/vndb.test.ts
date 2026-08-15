import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./vndb";
import details, { manifest as detailsManifest } from "./vndb-details.sandbox";
import search, { manifest as searchManifest } from "./vndb-search.sandbox";

type VndbHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: VndbHost["httpCall"]) => defineSandboxTestHost(manifest, { httpCall });
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("visual-novel.vndb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
		]).toEqual([
			["visual-novel.vndb.search", "search", ["httpCall"]],
			["visual-novel.vndb.details", "details", ["httpCall"]],
		]);
	});
	it("maps VN search hits and drops entries missing an id or title", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.host).toBe("api.vndb.org");
			expect(requestUrl.pathname).toBe("/kana/vn");
			return httpSuccess({
				count: 3,
				more: true,
				results: [
					{
						id: "v17",
						title: "Ever17",
						released: "2002-08-29",
						image: { url: "https://i/17.jpg" },
					},
					{ id: "v18", title: "Partial", released: "2005" },
					{ id: "v19", title: "" },
					{ title: "No Id" },
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "ever", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{ title: "Ever17", metadata: [2002], externalId: "v17", imageUrl: "https://i/17.jpg" },
						{ title: "Partial", metadata: [2005], externalId: "v18" },
					]);
					expect(result.details).toEqual({ totalItems: 3, nextPage: 2 });
					return undefined;
				}),
			),
		);
	});
	it("groups developers into a company related-entity group and maps VN properties", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [
					{
						id: "v17",
						title: "Ever17",
						rating: 85.5,
						devstatus: 0,
						released: "2002-08-29",
						length_minutes: 3000,
						description: "A time-loop mystery.",
						image: { url: "https://i/cover.jpg" },
						screenshots: [
							{ url: "https://i/shot1.jpg" },
							{ url: "https://i/shot1.jpg" },
							{ url: "https://i/shot2.jpg" },
						],
						tags: [{ name: "Mystery" }, { name: "Science Fiction" }, { name: "" }],
						developers: [
							{ id: "p1", name: "KID" },
							{ id: "p1", name: "KID" },
							{ id: "p2", name: "" },
						],
					},
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "v17" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Ever17");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "person-to-visual-novel",
							entities: [
								{
									name: "KID",
									externalId: "p1",
									providerSlug: "person.vndb",
									relationshipProperties: { roles: ["Developer"] },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						lengthMinutes: 3000,
						publishYear: 2002,
						providerRating: 85.5,
						productionStatus: "Finished",
						publishDate: "2002-08-29",
						description: "A time-loop mystery.",
						genres: ["Mystery", "Science Fiction"],
						sourceUrl: "https://vndb.org/v17",
						images: [
							{ type: "remote", url: "https://i/cover.jpg", purpose: "cover" },
							{ type: "remote", url: "https://i/shot1.jpg", purpose: "screenshot" },
							{ type: "remote", url: "https://i/shot2.jpg", purpose: "screenshot" },
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("rejects an externalId that is not a VNDB VN id", () => {
		const host = makeHost(() => httpSuccess({ results: [] }));
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) => expect(String(error)).toContain("externalId must be a VNDB VN ID")),
			),
		);
	});
});
