import { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { execution } from "../automations/automation-test-utils";
import definition, { manifest } from "./media-monitoring-targets.sandbox";

const field = (value: string) => ({ kind: "text", value });

describe("media monitoring target activity", () => {
	it("extracts provider ids from global monitorable roots and preserves pagination", async () => {
		const documents: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			executeQueryEngine: (document) =>
				Effect.sync(() => {
					documents.push(document);
					return {
						type: "rows",
						data: {
							pageInfo: { page: 2, limit: 100, total: 201, hasMore: true },
							items: [
								{
									entityId: field("entity-a"),
									externalId: field("external-a"),
									providerId: field("provider-a"),
									entitySchemaSlug: field("movie"),
								},
								{
									entityId: field("malformed"),
									externalId: field("external-b"),
									providerId: { kind: "null", value: null },
									entitySchemaSlug: field("movie"),
								},
							],
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
		expect(() => Schema.decodeUnknownSync(QueryDocument)(documents[0])).not.toThrow();
		expect(documents[0]).toMatchObject({
			source: {
				type: "entities",
				alias: "entity",
				where: { type: "and" },
				schemas: expect.arrayContaining(["movie", "company", "person"]),
			},
			output: { type: "rows", pagination: { page: 2, limit: 100 } },
		});
		const serialized = JSON.stringify(documents[0]);
		expect(serialized).toContain('"schema":"media-monitoring"');
		expect(serialized).toContain('"name":"providerId"');
		expect(serialized).toContain('"name":"externalId"');
		expect(serialized).not.toContain("show-season");
	});
});
