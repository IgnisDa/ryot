import { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { execution } from "../automations/automation-test-utils";
import definition, { manifest } from "./media-monitoring-targets.sandbox";

const field = (value: string) => ({ kind: "text", value });

describe("media monitoring targets", () => {
	it("extracts provider ids from global monitorable roots and preserves pagination", async () => {
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return {
						data: {
							targets: {
								type: "rows",
								pageInfo: { page: 2, limit: 100, total: 201, hasMore: true },
								items: [
									{
										entityId: field("entity-a"),
										externalId: field("external-a"),
										providerId: field("provider-a"),
										entitySchemaSlug: field("movie"),
									},
								],
							},
						},
					};
				}),
		});

		await expect(
			Effect.runPromise(runSandboxTestScript(definition, { page: 2, limit: 100 }, host, execution)),
		).resolves.toEqual({
			hasMore: true,
			items: [
				{
					entityId: "entity-a",
					externalId: "external-a",
					providerId: "provider-a",
					entitySchemaSlug: "movie",
				},
			],
		});
		expect(Schema.is(RyotQLDocument)(documents[0])).toBe(true);
		expect(documents[0]).toMatchObject({
			queries: {
				targets: {
					from: { table: "entity", alias: "entity" },
					where: { type: "and" },
					output: { type: "rows", pagination: { page: 2, limit: 100 } },
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
