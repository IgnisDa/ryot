import { describe, expect, it } from "@effect/vitest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-monitoring-targets.sandbox";

describe("media monitoring targets", () => {
	it.live(
		"extracts provider ids from global monitorable roots and preserves cursor pagination",
		() =>
			Effect.gen(function* () {
				const documents: unknown[] = [];
				const host = defineSandboxTestHost(manifest, {
					executeRyotql: (document) =>
						Effect.sync(() => {
							documents.push(document);
							return {
								data: {
									targets: {
										type: "rows",
										pageInfo: { limit: 100, hasMore: true, nextCursor: "next-targets" },
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

				expect(
					yield* runSandboxTestScript(
						definition,
						{ limit: 100, after: "targets-cursor" },
						host,
						execution,
					),
				).toEqual({
					nextCursor: "next-targets",
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
							where: { type: "and" },
							from: { table: "entity", alias: "entity" },
							output: { type: "rows", pagination: { limit: 100, after: "targets-cursor" } },
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
				expect(serialized).not.toContain('"table":"entity","alias":"mediaLibrary"');
				expect(serialized).not.toContain("show-season");
			}),
	);
});
