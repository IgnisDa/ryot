import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
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
		items: monitoringLibraryId ? [{ libraryEntityId: field(monitoringLibraryId) }] : [],
		pageInfo: { limit: 1, hasMore: false },
	},
});
const rows = (items: unknown[]) => ({
	data: {
		targets: {
			type: "rows",
			items,
			pageInfo: { page: 1, limit: 50, total: items.length, hasMore: false },
		},
	},
});

const libraryRows = (items: unknown[]) => ({
	data: {
		library: {
			type: "rows",
			items,
			pageInfo: { page: 1, limit: 1, total: items.length, hasMore: false },
		},
	},
});

describe("media monitoring operations", () => {
	it("pushes monitorability and status into one query and keeps duplicate results aligned", async () => {
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(statusManifest, {
			executeRyotql: (document) =>
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
		expect(Schema.is(RyotQLDocument)(documents[0])).toBe(true);
		expect(documents[0]).toMatchObject({
			queries: {
				targets: {
					from: { table: "entity", alias: "entity" },
					where: { type: "and" },
					output: {
						type: "rows",
						pagination: { page: 1, limit: 3 },
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
		expect(serialized).not.toContain('"table":"entity","alias":"library"');
		expect(serialized).not.toContain("show-season");
	});

	it("enables valid targets with one atomic relationship batch and no user id", async () => {
		const changes: unknown[] = [];
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(enableManifest, {
			executeRyotql: (document) =>
				Effect.sync(() => {
					documents.push(document);
					const query = Schema.decodeUnknownSync(RyotQLDocument)(document);
					return "library" in query.queries
						? libraryRows([{ entityId: field("library-1") }])
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
			expect(Schema.is(RyotQLDocument)(document)).toBe(true);
		}
		expect(JSON.stringify(changes)).not.toContain("userId");
	});

	it("disables only existing monitoring edges and leaves ordinary library membership alone", async () => {
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
