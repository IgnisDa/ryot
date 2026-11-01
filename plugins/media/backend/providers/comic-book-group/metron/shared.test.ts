import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import { mediaFailureMessage } from "../../../lib/error-message";
import relatedScript, { manifest as relatedManifest } from "./related.sandbox";
import { details, manifest, related, search } from "./shared";

type MetronGroupHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: MetronGroupHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfig: ({ required: keys = [] }) =>
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
							coverage: { status: "complete" },
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

	it("fails when the issue-list results field is missing", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({ count: 0, next: null })
				: httpSuccess({ name: "Saga", issue_count: 0 }),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "10" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(mediaFailureMessage(error)).toContain("issue-list results are malformed"),
				),
			),
		);
	});

	it("accepts an empty issue list when the source is exhausted", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({ count: 0, next: null, results: [] })
				: httpSuccess({ name: "Saga", issue_count: 0 }),
		);

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "10" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups?.[0]).toMatchObject({
						entities: [],
						coverage: { status: "complete" },
					});
				}),
			),
		);
	});

	it("rejects an invalid issue identity on the terminal issue-list page", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({ count: 101, next: null, results: [{}] })
				: httpSuccess({ name: "Saga", issue_count: 101 }),
		);

		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "10",
					direction: "outgoing",
					continuation: { page: 2, offset: 100 },
					relationshipSchemaSlug: "comic-book-group-to-comic-book",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => expect(mediaFailureMessage(error)).toContain("invalid issue")),
			),
		);
	});

	it("rejects an empty issue page while the source reports remaining issues", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({ count: 101, next: null, results: [] })
				: httpSuccess({ name: "Saga", issue_count: 101 }),
		);

		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "10",
					direction: "outgoing",
					continuation: { page: 2, offset: 100 },
					relationshipSchemaSlug: "comic-book-group-to-comic-book",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(mediaFailureMessage(error)).toContain("empty before coverage is complete"),
				),
			),
		);
	});

	it("declares the durable related operation with its canonical provider slug", () => {
		expect([relatedManifest.slug, related.operation, relatedScript.operation]).toEqual([
			"comic-book-group.metron.related",
			"related",
			"related",
		]);
	});

	it("follows issue pages beyond 100 results and preserves order across continuations", () => {
		const requestedPages: number[] = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.pathname.includes("/issue_list/")) {
				const page = Number(requestUrl.searchParams.get("page"));
				requestedPages.push(page);
				const start = (page - 1) * 100 + 1;
				const length = page === 4 ? 1 : 100;
				return httpSuccess({
					count: 301,
					results: Array.from({ length }, (_, index) => ({
						id: start + index,
						issue: `Issue ${start + index}`,
					})),
					next:
						page < 4
							? `https://metron.cloud/api/series/10/issue_list/?page_size=100&page=${page + 1}`
							: null,
				});
			}
			return httpSuccess({ name: "Saga", issue_count: 301 });
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(details, { externalId: "10" }, host, execution);
				const firstGroup = first.relatedEntityGroups?.[0];
				expect(firstGroup?.coverage).toEqual({
					status: "more",
					continuation: { page: 2, offset: 100 },
				});
				expect(firstGroup?.entities[0]?.relationshipProperties).toEqual({ order: 1 });
				let continuation =
					firstGroup?.coverage.status === "more" ? firstGroup.coverage.continuation : null;
				const relatedEntities: Array<{ externalId: string; relationshipProperties?: unknown }> = [];
				while (continuation !== null) {
					const result = yield* runSandboxTestScript(
						related,
						{
							continuation,
							externalId: "10",
							direction: "outgoing",
							relationshipSchemaSlug: "comic-book-group-to-comic-book",
						},
						host,
						execution,
					);
					relatedEntities.push(...result.entities);
					continuation = result.coverage.status === "more" ? result.coverage.continuation : null;
				}
				expect(requestedPages).toEqual([1, 2, 3, 4]);
				expect(relatedEntities).toHaveLength(201);
				expect(relatedEntities[0]).toMatchObject({
					externalId: "101",
					relationshipProperties: { order: 101 },
				});
				expect(relatedEntities[99]).toMatchObject({
					externalId: "200",
					relationshipProperties: { order: 200 },
				});
				expect(relatedEntities[100]).toMatchObject({
					externalId: "201",
					relationshipProperties: { order: 201 },
				});
				expect(relatedEntities.at(-1)).toMatchObject({
					externalId: "301",
					relationshipProperties: { order: 301 },
				});
			}),
		);
	});

	it("deduplicates duplicate issue IDs while retaining the first order", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({
						count: 3,
						results: [
							{ id: 1, issue: "First" },
							{ id: 1, issue: "Duplicate" },
							{ id: 2, issue: "Second" },
						],
					})
				: httpSuccess({ name: "Saga", issue_count: 3 }),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "10" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups?.[0]?.entities).toMatchObject([
						{ name: "First", externalId: "1", relationshipProperties: { order: 1 } },
						{ name: "Second", externalId: "2", relationshipProperties: { order: 3 } },
					]);
				}),
			),
		);
	});

	it("uses the upstream count when a next link is absent", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (!requestUrl.pathname.includes("/issue_list/")) {
				return httpSuccess({ name: "Saga", issue_count: 2 });
			}
			return requestUrl.searchParams.get("page") === "1"
				? httpSuccess({ count: 2, next: null, results: [{ id: 1, issue: "First" }] })
				: httpSuccess({ count: 2, next: null, results: [{ id: 2, issue: "Second" }] });
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(details, { externalId: "10" }, host, execution);
				const firstGroup = first.relatedEntityGroups?.[0];
				if (firstGroup?.coverage.status !== "more") {
					throw new Error("Expected count-based issue-list continuation");
				}
				expect(firstGroup.coverage.continuation).toEqual({ page: 2, offset: 1 });
				const result = yield* runSandboxTestScript(
					related,
					{
						externalId: "10",
						direction: "outgoing",
						continuation: firstGroup.coverage.continuation,
						relationshipSchemaSlug: "comic-book-group-to-comic-book",
					},
					host,
					execution,
				);
				expect(result.coverage).toEqual({ status: "complete" });
				expect(result.entities).toMatchObject([
					{ externalId: "2", relationshipProperties: { order: 2 } },
				]);
			}),
		);
	});

	it("rejects non-canonical upstream next URLs", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? httpSuccess({
						count: 101,
						results: [],
						next: "https://example.com/series/10/issue_list/?page=2",
					})
				: httpSuccess({ name: "Saga", issue_count: 101 }),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "10" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(mediaFailureMessage(error)).toContain("outside the canonical API path"),
				),
			),
		);
	});

	it("fails a related page request instead of publishing it as complete", () => {
		const host = makeHost((_method, url) =>
			url.includes("/issue_list/")
				? Effect.fail({ message: "Metron unavailable" })
				: httpSuccess({ name: "Saga", issue_count: 101 }),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				related,
				{
					externalId: "10",
					direction: "outgoing",
					continuation: { page: 2, offset: 100 },
					relationshipSchemaSlug: "comic-book-group-to-comic-book",
				},
				host,
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => expect(mediaFailureMessage(error)).toContain("Metron unavailable")),
			),
		);
	});
});
