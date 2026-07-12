import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { MediaMonitoringEnableInput, MediaMonitoringOutput } from "../../operations/schemas";
import { execution } from "../automations/automation-test-utils";
import disableDefinition, { manifest as disableManifest } from "./media-monitoring-disable.sandbox";
import enableDefinition, { manifest as enableManifest } from "./media-monitoring-enable.sandbox";
import statusDefinition, { manifest as statusManifest } from "./media-monitoring-status.sandbox";

const field = (value: string) => ({ kind: "text", value });
const target = (entityId: string, monitoringLibraryId: string | null = null) => ({
	entityId: field(entityId),
	externalId: field(`external-${entityId}`),
	providerId: field(`provider-${entityId}`),
	entitySchemaSlug: field("movie"),
	monitoringLibraries: {
		items: monitoringLibraryId ? [{ entityId: field(monitoringLibraryId) }] : [],
	},
});
const rows = (items: unknown[]) => ({
	type: "rows",
	data: {
		items,
		pageInfo: { page: 1, limit: 50, total: items.length, hasMore: false },
	},
});

describe("media monitoring operations", () => {
	it("pushes monitorability and status into one query and keeps duplicate results aligned", async () => {
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(statusManifest, {
			executeQueryEngine: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return rows([target("entity-a", "library-1")]);
				}),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					statusDefinition,
					{ entityIds: ["entity-a", "missing", "entity-a"] },
					host,
					execution,
				),
			),
		).resolves.toEqual({
			results: [
				{ entityId: "entity-a", status: "found", isMediaMonitored: true },
				{ entityId: "missing", status: "notFound" },
				{ entityId: "entity-a", status: "found", isMediaMonitored: true },
			],
		});
		expect(documents).toHaveLength(1);
		expect(Schema.is(QueryDocument)(documents[0])).toBe(true);
		expect(documents[0]).toMatchObject({
			source: {
				type: "entities",
				alias: "entity",
				where: { type: "and" },
				schemas: expect.arrayContaining(["movie", "company", "person"]),
			},
			output: {
				type: "rows",
				pagination: { page: 1, limit: 3 },
				include: [
					expect.objectContaining({
						key: "monitoringLibraries",
						source: expect.objectContaining({
							via: expect.objectContaining({ schema: "media-monitoring" }),
						}),
					}),
				],
			},
		});
		expect(JSON.stringify(documents[0])).toContain('"name":"userId"');
		expect(JSON.stringify(documents[0])).toContain('"name":"providerId"');
		expect(JSON.stringify(documents[0])).toContain('"name":"externalId"');
		expect(JSON.stringify(documents[0])).not.toContain("show-season");
	});

	it("enables valid targets with one atomic relationship batch and no user id", async () => {
		const changes: unknown[] = [];
		const documents: unknown[] = [];
		const QuerySource = Schema.Struct({ source: Schema.Struct({ alias: Schema.String }) });
		const host = defineSandboxTestHost(enableManifest, {
			executeQueryEngine: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return Schema.decodeUnknownSync(QuerySource)(document).source.alias === "library"
						? rows([{ entityId: field("library-1") }])
						: rows([target("entity-a")]);
				}),
			changeUserRelationships: (batches) =>
				Effect.sync(() => {
					changes.push(batches);
					return [{ created: 2, deleted: 0 }];
				}),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					enableDefinition,
					{ entityIds: ["entity-a", "missing"] },
					host,
					execution,
				),
			),
		).resolves.toEqual({
			results: [
				{ entityId: "entity-a", status: "found", isMediaMonitored: true },
				{ entityId: "missing", status: "notFound" },
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
							relationshipSchemaSlug: "in-library",
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
			expect(Schema.is(QueryDocument)(document)).toBe(true);
		}
		expect(JSON.stringify(changes)).not.toContain("userId");
	});

	it("disables only existing monitoring edges and leaves ordinary library membership alone", async () => {
		const changes: unknown[] = [];
		const host = defineSandboxTestHost(disableManifest, {
			executeQueryEngine: () =>
				Effect.succeed(rows([target("entity-a", "library-1"), target("entity-b")])),
			changeUserRelationships: (batches) =>
				Effect.sync(() => {
					changes.push(batches);
					return [{ created: 0, deleted: 1 }];
				}),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(
					disableDefinition,
					{ entityIds: ["entity-a", "entity-b", "missing"] },
					host,
					execution,
				),
			),
		).resolves.toEqual({
			results: [
				{ entityId: "entity-a", status: "found", isMediaMonitored: false },
				{ entityId: "entity-b", status: "found", isMediaMonitored: false },
				{ entityId: "missing", status: "notFound" },
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
		expect(JSON.stringify(changes)).not.toContain("in-library");
	});

	it("bounds operation batches and validates aligned result variants", () => {
		expect(() => Schema.decodeUnknownSync(MediaMonitoringEnableInput)({ entityIds: [] })).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(MediaMonitoringEnableInput)({
				entityIds: Array.from({ length: 51 }, (_, index) => `entity-${index}`),
			}),
		).toThrow();
		expect(
			Schema.decodeUnknownSync(MediaMonitoringOutput)({
				results: [
					{ entityId: "entity-a", status: "found", isMediaMonitored: true },
					{ entityId: "missing", status: "notFound" },
				],
			}),
		).toEqual({
			results: [
				{ entityId: "entity-a", status: "found", isMediaMonitored: true },
				{ entityId: "missing", status: "notFound" },
			],
		});
	});
});
