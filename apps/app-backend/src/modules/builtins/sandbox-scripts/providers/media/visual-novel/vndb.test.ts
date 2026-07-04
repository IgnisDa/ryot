import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./vndb.sandbox";

type VndbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: VndbHost["httpCall"]) => defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("visual-novel.vndb sandbox script", () => {
	it("maps VN search hits and drops entries missing an id or title", () => {
		const host = makeHost(() =>
			httpSuccess({
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
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "ever", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "v17",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Ever17" },
					primarySubtitleProperty: { kind: "number", value: 2002 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://i/17.jpg" } },
				},
				{
					externalId: "v18",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Partial" },
					primarySubtitleProperty: { kind: "number", value: 2005 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 3, nextPage: 2 });
			return undefined;
		});
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

		return runSandboxTestDriver(details, { externalId: "v17" }, host, execution).then((result) => {
			expect(result.name).toBe("Ever17");
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "incoming",
					synchronization: "authoritative",
					relationshipSchemaSlug: "company-to-visual-novel",
					entities: [
						{
							name: "KID",
							externalId: "p1",
							scriptSlug: "company.vndb",
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
					{ type: "remote", url: "https://i/cover.jpg" },
					{ type: "remote", url: "https://i/shot1.jpg" },
					{ type: "remote", url: "https://i/shot2.jpg" },
				],
			});
			return undefined;
		});
	});

	it("rejects an externalId that is not a VNDB VN id", () => {
		const host = makeHost(() => httpSuccess({ results: [] }));
		return runSandboxTestDriver(details, { externalId: "p1" }, host, execution).then(
			() => expect.unreachable("expected details to reject a non-VN externalId"),
			(error: unknown) => {
				expect(error).toBeInstanceOf(Error);
				return undefined;
			},
		);
	});
});
