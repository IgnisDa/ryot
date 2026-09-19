import { describe, expect, it } from "@effect/vitest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import { MediaMonitoringEnableInput, MediaMonitoringOutput } from "../contracts/operations";
import disableDefinition, { manifest as disableManifest } from "./media-monitoring-disable.sandbox";
import enableDefinition, { manifest as enableManifest } from "./media-monitoring-enable.sandbox";
import statusDefinition, { manifest as statusManifest } from "./media-monitoring-status.sandbox";

const target = (entityId: string, monitoringLibraryId: string | null = null) => ({
	entityId,
	entitySchemaSlug: "movie",
	externalId: `external-${entityId}`,
	providerId: `provider-${entityId}`,
	monitoringLibraries: {
		pageInfo: { limit: 1, hasMore: false },
		items: monitoringLibraryId ? [{ libraryEntityId: monitoringLibraryId }] : [],
	},
});
const rows = (items: unknown[]) => ({
	data: {
		targets: { items, type: "rows", pageInfo: { limit: 50, hasMore: false, nextCursor: null } },
	},
});

const libraryRows = (items: unknown[]) => ({
	data: {
		mediaLibrary: { items, type: "rows", pageInfo: { limit: 1, hasMore: false, nextCursor: null } },
	},
});

describe("media monitoring operations", () => {
	it.live(
		"pushes monitorability and status into one query and keeps duplicate results aligned",
		() =>
			Effect.gen(function* () {
				const documents: unknown[] = [];
				const host = defineSandboxTestHost(statusManifest, {
					executeRyotql: (document) =>
						Effect.sync(() => {
							documents.push(document);
							return rows([target("entity-a", "library-1")]);
						}),
				});

				expect(
					yield* runSandboxTestScript(
						statusDefinition,
						{ entityIds: ["entity-a", "missing", "entity-a"] },
						host,
						execution,
					),
				).toEqual({
					results: [
						{ status: "found", entityId: "entity-a", isMediaMonitored: true },
						{ status: "notFound", entityId: "missing" },
						{ status: "found", entityId: "entity-a", isMediaMonitored: true },
					],
				});
				expect(documents).toHaveLength(1);
				expect(Schema.is(RyotQLDocument)(documents[0])).toBe(true);
				expect(documents[0]).toMatchObject({
					queries: {
						targets: {
							where: { type: "and" },
							from: { table: "entity", alias: "entity" },
							output: {
								type: "rows",
								pagination: { limit: 3 },
								include: [
									expect.objectContaining({
										key: "monitoringLibraries",
										from: { table: "relationship", alias: "monitoringRelationship" },
									}),
								],
							},
						},
					},
				});
				const serialized = JSON.stringify(documents[0]);
				expect(serialized).toContain('"field":"targetEntityId"');
				expect(serialized).toContain(
					'"field":"userId","type":"column","tableAlias":"monitoringRelationship"},"type":"isNotNull"',
				);
				expect(serialized).toContain('"field":"providerId"');
				expect(serialized).toContain('"field":"externalId"');
				expect(serialized).not.toContain('"table":"entity","alias":"mediaLibrary"');
				expect(serialized).not.toContain("show-season");
			}),
	);

	it.live("enables valid targets with one atomic relationship batch and no user id", () =>
		Effect.gen(function* () {
			const changes: unknown[] = [];
			const documents: unknown[] = [];
			const host = defineSandboxTestHost(enableManifest, {
				changeUserRelationships: (batches) =>
					Effect.sync(() => {
						changes.push(batches);
						return [{ created: 2, deleted: 0 }];
					}),
				executeRyotql: (document) =>
					Effect.gen(function* () {
						documents.push(document);
						const query = yield* Schema.decodeEffect(RyotQLDocument)(document).pipe(Effect.orDie);
						return "mediaLibrary" in query.queries
							? libraryRows([{ entityId: "library-1" }])
							: rows([target("entity-a")]);
					}),
			});

			expect(
				yield* runSandboxTestScript(
					enableDefinition,
					{ entityIds: ["entity-a", "missing"] },
					host,
					execution,
				),
			).toEqual({
				results: [
					{ status: "found", entityId: "entity-a", isMediaMonitored: true },
					{ status: "notFound", entityId: "missing" },
				],
			});
			expect(changes).toEqual([
				[
					{
						deletes: [],
						creates: [
							{
								properties: {},
								sourceEntityId: "entity-a",
								targetEntityId: "library-1",
								relationshipSchemaSlug: "in-media-library",
							},
							{
								properties: {},
								sourceEntityId: "entity-a",
								targetEntityId: "library-1",
								relationshipSchemaSlug: "media-monitoring",
							},
						],
					},
				],
			]);
			expect(documents).toHaveLength(2);
			for (const document of documents) {
				expect(Schema.is(RyotQLDocument)(document)).toBe(true);
			}
			expect(JSON.stringify(changes)).not.toContain("userId");
		}),
	);

	it.live(
		"disables only existing monitoring edges and leaves ordinary media library membership alone",
		() =>
			Effect.gen(function* () {
				const changes: unknown[] = [];
				const host = defineSandboxTestHost(disableManifest, {
					executeRyotql: () =>
						Effect.succeed(rows([target("entity-a", "library-1"), target("entity-b")])),
					changeUserRelationships: (batches) =>
						Effect.sync(() => {
							changes.push(batches);
							return [{ created: 0, deleted: 1 }];
						}),
				});

				expect(
					yield* runSandboxTestScript(
						disableDefinition,
						{ entityIds: ["entity-a", "entity-b", "missing"] },
						host,
						execution,
					),
				).toEqual({
					results: [
						{ status: "found", entityId: "entity-a", isMediaMonitored: false },
						{ status: "found", entityId: "entity-b", isMediaMonitored: false },
						{ status: "notFound", entityId: "missing" },
					],
				});
				expect(changes).toEqual([
					[
						{
							creates: [],
							deletes: [
								{
									sourceEntityId: "entity-a",
									targetEntityId: "library-1",
									relationshipSchemaSlug: "media-monitoring",
								},
							],
						},
					],
				]);
				expect(JSON.stringify(changes)).not.toContain("in-media-library");
			}),
	);

	it("bounds operation batches and validates aligned result variants", () => {
		expect(() => Schema.decodeSync(MediaMonitoringEnableInput)({ entityIds: [] })).toThrow();
		expect(() =>
			Schema.decodeSync(MediaMonitoringEnableInput)({
				entityIds: Array.from({ length: 51 }, (_, index) => `entity-${index}`),
			}),
		).toThrow();
		expect(
			Schema.decodeSync(MediaMonitoringOutput)({
				results: [
					{ status: "found", entityId: "entity-a", isMediaMonitored: true },
					{ status: "notFound", entityId: "missing" },
				],
			}),
		).toEqual({
			results: [
				{ status: "found", entityId: "entity-a", isMediaMonitored: true },
				{ status: "notFound", entityId: "missing" },
			],
		});
	});
});
