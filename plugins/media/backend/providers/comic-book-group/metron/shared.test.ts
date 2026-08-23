import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./shared";

type MetronGroupHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: MetronGroupHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(keys.map((key) => [key, key === "metronUsername" ? "user" : "pass"])),
			),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("comic-book-group.metron sandbox script", () => {
	it("maps series search hits with issue_count metadata", () => {
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

		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "saga" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([{ title: "Saga", metadata: [60], externalId: "10" }]);
					expect(result.details).toEqual({ totalItems: 1, nextPage: null });
				}),
			),
		);
	});

	it("sets nextPage when the payload reports a next link", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 100,
				next: "https://metron.cloud/api/series/?page=2",
				results: [{ id: 10, name: "Saga", issue_count: 60 }],
			}),
		);

		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "saga" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.details).toEqual({ nextPage: 2, totalItems: 100 });
				}),
			),
		);
	});

	it("maps series details and orders member issues", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/issue_list/")) {
				return httpSuccess({
					results: [{ id: 1, issue: "Saga #1" }, { id: 2, issue_name: "Saga #2" }, { id: 3 }],
				});
			}
			return httpSuccess({ name: "Saga", issue_count: 3, desc: "A comic." });
		});

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "10" }, host, execution).pipe(
				Effect.map((result) => {
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
									providerSlug: "comic-book.metron",
									relationshipProperties: { order: 1 },
								},
								{
									name: "Saga #2",
									externalId: "2",
									providerSlug: "comic-book.metron",
									relationshipProperties: { order: 2 },
								},
								{
									externalId: "3",
									name: "Loading...",
									providerSlug: "comic-book.metron",
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
				}),
			),
		);
	});
});
