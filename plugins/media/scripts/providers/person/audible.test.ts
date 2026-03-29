import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./audible.sandbox";

type AudiblePersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: AudiblePersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.audible sandbox script", () => {
	it("paginates the author list and drops entries without an asin or name", () => {
		const host = makeHost(() =>
			httpSuccess([
				{ asin: "a1", name: "First Author" },
				{ asin: "a2", name: "" },
				{ name: "No Asin" },
				{ asin: "a3", name: "Third Author" },
			]),
		);

		return runSandboxTestDriver(
			search,
			{ query: "author", page: 1, pageSize: 2 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "a1",
					titleProperty: { kind: "text", value: "First Author" },
					calloutProperty: { kind: "null", value: null },
					imageProperty: { kind: "null", value: null },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
				},
			]);
			expect(result.details).toEqual({ totalItems: 4, nextPage: 2 });
			return undefined;
		});
	});

	it("maps author details to name, image and source url", () => {
		const host = makeHost(() =>
			httpSuccess({
				name: "Author Name",
				description: "Bio text.",
				image: "https://img/author.jpg",
			}),
		);

		return runSandboxTestDriver(details, { externalId: "a1" }, host, execution).then((result) => {
			expect(result.name).toBe("Author Name");
			expect(result.properties).toEqual({
				alternateNames: [],
				description: "Bio text.",
				sourceUrl: "https://www.audible.com/author/a1",
				images: [{ type: "remote", url: "https://img/author.jpg" }],
			});
			return undefined;
		});
	});

	it("throws when the author payload has no name", () => {
		const host = makeHost(() => httpSuccess({ description: "Bio." }));

		return expect(
			runSandboxTestDriver(details, { externalId: "a1" }, host, execution),
		).rejects.toThrow("Audnex returned no author name");
	});
});
