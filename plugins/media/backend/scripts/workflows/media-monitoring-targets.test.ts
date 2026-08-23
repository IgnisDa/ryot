import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { execution } from "../automations/automation-test-utils";
import definition, { manifest } from "./media-monitoring-targets.sandbox";

describe("media monitoring targets", () => {
	it("extracts provider ids from global monitorable roots and preserves cursor pagination", async () => {
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return {
						data: {
							targets: {
								type: "rows",
								pageInfo: { hasMore: true, limit: 100, nextCursor: "next-targets" },
								items: [
									{
										entityId: "entity-a",
										externalId: "external-a",
										providerId: "provider-a",
										entitySchemaSlug: "movie",
									},
								],
							},
						},
					};
				}),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(definition, { after: "targets-cursor", limit: 100 }, host, execution),
			),
		).resolves.toEqual({
			items: [
				{
					entityId: "entity-a",
					externalId: "external-a",
					providerId: "provider-a",
					entitySchemaSlug: "movie",
				},
			],
			nextCursor: "next-targets",
		});
		expect(Schema.is(RyotQLDocument)(documents[0])).toBe(true);
		expect(documents[0]).toMatchObject({
			queries: {
				targets: {
					from: { table: "entity", alias: "entity" },
					where: { type: "and" },
					output: {
						type: "rows",
						pagination: { after: "targets-cursor", limit: 100 },
					},
				},
			},
		});
		const serialized = JSON.stringify(documents[0]);
		expect(serialized).toContain('"field":"relationshipSchemaSlug"');
		expect(serialized).toContain(
			'"field":"userId","type":"column","tableAlias":"monitoringRelationship"},"type":"isNotNull"',
		);
		expect(serialized).toContain('"field":"providerId"');
		expect(serialized).toContain('"field":"externalId"');
		expect(serialized).not.toContain('"table":"entity","alias":"library"');
		expect(serialized).not.toContain("show-season");
	});
});
