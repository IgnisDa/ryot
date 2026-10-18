import { describe, expect, layer } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	EntityEnrichmentRefused,
	EntityNotFound,
} from "@ryot-app/contract/modules/entities/schemas";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { EntityId, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { PluginEnrichmentRequest } from "@ryot-app/plugin-client-contract";
import { Effect, Layer } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { EntitiesApi } from "#/api/entities";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { PluginEnrichment } from "#/modules/pages/bridge/enrichment";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const contributor = PluginId.make("plugin-1");
const entityId = EntityId.make("entity-1");
const contributors: PreparedClientPage["identity"]["contributors"] = [
	{
		kind: "plugin",
		pluginId: contributor,
		revisionId: "revision-1",
		contentHash: "source-hash",
		installationId: "installation-1",
		packageId: PluginPackageId.make("test/fixture"),
	},
	{ name: "table", kind: "kernel-renderer", sourceHash: "source-hash" },
];

const calls: unknown[] = [];
const failures: unknown[] = [];

const entitiesApi = Layer.succeed(EntitiesApi, {
	saveEditor: () => Effect.die("unused"),
	requestEnrichment: (_scope, request) => {
		calls.push(request);
		const failure = failures.shift();
		return failure === undefined
			? Effect.succeed({ enrichmentRequestId: "enrichment-job" })
			: Effect.fail(new AuthenticatedApiError({ cause: failure }));
	},
});

const outcome = (request: PluginEnrichmentRequest) =>
	Effect.flatMap(PluginEnrichment, (enrichment) =>
		enrichment.outcome(scope, contributors, request),
	);

describe("plugin entity enrichment", () => {
	layer(PluginEnrichment.layer.pipe(Layer.provide(entitiesApi)))((test) => {
		test.effect("refuses plugins that do not contribute to the document", () =>
			Effect.gen(function* () {
				calls.length = 0;
				expect(
					yield* outcome({
						entityId,
						action: "retry",
						operation: "population",
						pluginId: PluginId.make("plugin-2"),
						idempotencyKey: "test-enrichment-key",
					}),
				).toEqual({ outcome: "failure", reason: "invalid-request" });
				expect(calls).toEqual([]);
			}),
		);

		test.effect("forwards enrichment requests and maps failures", () =>
			Effect.gen(function* () {
				calls.length = 0;
				expect(
					yield* outcome({
						entityId,
						action: "retry",
						pluginId: contributor,
						operation: "population",
						idempotencyKey: "test-enrichment-key",
					}),
				).toEqual({ outcome: "success", enrichmentRequestId: "enrichment-job" });
				expect(calls).toEqual([
					{
						params: { entityId },
						payload: {
							action: "retry",
							pluginId: contributor,
							operation: "population",
							idempotencyKey: "test-enrichment-key",
						},
					},
				]);
				expect(
					yield* outcome({
						entityId,
						action: "retry",
						pluginId: contributor,
						operation: "translation",
						idempotencyKey: "test-enrichment-key",
					}),
				).toEqual({ outcome: "success", enrichmentRequestId: "enrichment-job" });
				expect(calls.at(-1)).toEqual({
					params: { entityId },
					payload: {
						action: "retry",
						pluginId: contributor,
						operation: "translation",
						idempotencyKey: "test-enrichment-key",
					},
				});

				failures.push(
					new EntityNotFound({ reason: { entityId, code: "entity-not-found" } }),
					new EntityEnrichmentRefused({ reason: { code: "provider-unavailable" } }),
					new AuthUnauthorized({ reason: { code: "authentication-required" } }),
					new Error("offline"),
				);
				for (const reason of [
					"invalid-request",
					"invalid-request",
					"invalid-request",
					"transport",
				] as const) {
					expect(
						yield* outcome({
							entityId,
							action: "retry",
							pluginId: contributor,
							operation: "population",
							idempotencyKey: "test-enrichment-key",
						}),
					).toEqual({ reason, outcome: "failure" });
				}
			}),
		);
	});
});
