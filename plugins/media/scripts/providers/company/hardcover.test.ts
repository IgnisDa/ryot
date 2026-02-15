import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./hardcover";

type HardcoverCompanyHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: HardcoverCompanyHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("hardcover-key"),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.hardcover sandbox script", () => {
	it("maps publisher hits and pages by result count", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					publishers: [{ id: 200, name: "Pub House" }, { id: 201, name: "" }, { name: "No Id" }],
				},
			}),
		);

		return runSandboxTestScript(
			search,
			{ query: "pub", page: 2, pageSize: 20 },
			host,
			execution,
		).pipe(
			Effect.map((result) => {
				expect(result.items).toEqual([
					{
						externalId: "200",
						imageProperty: { kind: "null", value: null },
						calloutProperty: { kind: "null", value: null },
						titleProperty: { kind: "text", value: "Pub House" },
						primarySubtitleProperty: { kind: "null", value: null },
						secondarySubtitleProperty: { kind: "null", value: null },
					},
				]);
				expect(result.details).toEqual({ totalItems: 21, nextPage: null });
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("surfaces GraphQL errors from the details response", () => {
		const host = makeHost(() => httpSuccess({ errors: [{ message: "boom" }] }));

		return expect(
			Effect.runPromise(runSandboxTestScript(details, { externalId: "200" }, host, execution)),
		).rejects.toThrow("Hardcover publisher details GraphQL error: boom");
	});

	it("emits published books as outgoing relationships", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					publishers_by_pk: {
						id: "200",
						name: "Pub House",
						url: "https://pub.example",
						editions: [{ book: { id: 42, title: "The Book" } }, { book: { title: "No Id" } }],
					},
				},
			}),
		);

		return runSandboxTestScript(details, { externalId: "200" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Pub House");
				expect(result.properties).toEqual({
					images: [],
					alternateNames: [],
					website: "https://pub.example",
				});
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "company-to-book",
						entities: [
							{
								name: "The Book",
								externalId: "42",
								providerSlug: "book.hardcover",
								relationshipProperties: { roles: ["Publisher"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
