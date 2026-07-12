import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./media-trending.sandbox";

type TrendingHost = SandboxHost<typeof manifest.capabilities>;

const execution = { metadata: {}, sandboxScriptId: "script-test" };
const httpSuccess = (body: unknown) =>
	Effect.succeed({
		status: 200,
		headers: {},
		body: JSON.stringify(body),
	});

describe("media trending cron", () => {
	it("preserves provider order and rank while atomically reconciling deduplicated self edges", () => {
		const entityWrites: Parameters<TrendingHost["upsertGlobalEntities"]>[0][] = [];
		const entityWriteOptions: Parameters<TrendingHost["upsertGlobalEntities"]>[1][] = [];
		const relationshipWrites: Parameters<TrendingHost["upsertGlobalRelationships"]>[0][] = [];
		const host = defineSandboxTestHost(manifest, {
			log: () => Effect.succeed(null),
			getPluginConfigValue: () => Effect.succeed("token"),
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				const page = requestUrl.searchParams.get("page");
				if (page !== "1") {
					return httpSuccess({ results: [] });
				}
				return requestUrl.pathname.includes("/trending/tv/")
					? httpSuccess({
							results: [
								{ id: 1, name: "Show One" },
								{ id: 3, name: "Show One Alias" },
								{ id: 4, name: "Skipped Show" },
							],
						})
					: httpSuccess({ results: [{ id: 2, title: "Movie One" }] });
			},
			upsertGlobalEntities: (items, options) =>
				Effect.sync(() => {
					entityWrites.push(items);
					entityWriteOptions.push(options);
					return items.map(({ entitySchemaSlug, externalId }, index) => {
						if (index === 2) {
							return { status: "skipped" as const };
						}
						return {
							status: "upserted" as const,
							wasInserted: true,
							entityId:
								entitySchemaSlug === "show" ? "show-entity" : `${entitySchemaSlug}-${externalId}`,
						};
					});
				}),
			upsertGlobalRelationships: (groups) =>
				Effect.sync(() => {
					relationshipWrites.push(groups);
					return groups.map(({ relationships }) => ({
						deleted: 1,
						upserted: relationships.length,
					}));
				}),
		});

		return Effect.runPromise(
			runSandboxTestScript(definition, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ synced: true, itemCount: 2, providerCount: 2 });
					expect(entityWrites.map((items) => items.map((item) => item.entitySchemaSlug))).toEqual([
						["show", "show", "show"],
						["movie"],
					]);
					expect(entityWriteOptions).toEqual([undefined, undefined]);
					expect(relationshipWrites).toHaveLength(1);
					const fetchedAt = relationshipWrites[0]?.[0]?.relationships[0]?.properties.fetchedAt;
					expect(fetchedAt).toEqual(expect.any(String));
					expect(relationshipWrites[0]).toEqual([
						{
							selector: { type: "self" },
							relationshipSchemaSlug: "media-trending",
							relationships: [
								{
									sourceEntityId: "show-entity",
									targetEntityId: "show-entity",
									properties: { rank: 1, fetchedAt },
								},
								{
									sourceEntityId: "movie-2",
									targetEntityId: "movie-2",
									properties: { rank: 2, fetchedAt },
								},
							],
						},
					]);
				}),
			),
		);
	});

	it("continues after a provider failure and preserves existing edges when all providers fail", async () => {
		const relationshipWrites: unknown[] = [];
		const logs: unknown[] = [];
		let failMovie = false;
		const host = defineSandboxTestHost(manifest, {
			log: (entries) =>
				Effect.sync(() => {
					logs.push(entries);
					return null;
				}),
			getPluginConfigValue: () => Effect.succeed("token"),
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				const isShow = requestUrl.pathname.includes("/trending/tv/");
				if (isShow || failMovie) {
					return Effect.fail({ message: "provider unavailable" });
				}
				return httpSuccess(
					requestUrl.searchParams.get("page") === "1"
						? { results: [{ id: 2, title: "Movie One" }] }
						: { results: [] },
				);
			},
			upsertGlobalEntities: (items) =>
				Effect.succeed(
					items.map(({ externalId }) => ({
						wasInserted: true,
						status: "upserted" as const,
						entityId: `movie-${externalId}`,
					})),
				),
			upsertGlobalRelationships: (groups) =>
				Effect.sync(() => {
					relationshipWrites.push(groups);
					return groups.map(({ relationships }) => ({
						deleted: 0,
						upserted: relationships.length,
					}));
				}),
		});

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, {}, host, execution)),
		).resolves.toEqual({ synced: true, itemCount: 1, providerCount: 1 });
		expect(relationshipWrites).toHaveLength(1);

		failMovie = true;
		await expect(
			Effect.runPromise(runSandboxTestScript(definition, {}, host, execution)),
		).resolves.toEqual({ synced: false, itemCount: 0, providerCount: 0 });
		expect(relationshipWrites).toHaveLength(1);
		expect(logs).toHaveLength(3);
	});
});
