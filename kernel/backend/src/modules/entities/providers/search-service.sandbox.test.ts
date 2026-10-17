import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { ProviderEntityBadRequest } from "@ryot-app/contract/modules/entity-providers/schemas";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	realSandboxLayer,
	RealSandboxScripts,
	realSandboxUserId,
} from "#modules/scripts/executions/real-sandbox.test-support";
import { durableHostFailure } from "#modules/scripts/host/durable-dispatcher";

import { ProviderEntitySearchService } from "./search-service";

const providerId = SandboxProviderId.make("sandbox-provider");
const user = {
	image: null,
	name: "Test User",
	id: realSandboxUserId,
	email: "user@example.com",
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: realSandboxUserId, token: "test-account-generation" },
} satisfies CurrentUserValue;

const providerSource = (call: string) => `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

export const manifest = defineManifest({
  kind: "provider",
  name: "Failing search",
  slug: "failing.search",
});

export default defineProvider({
  manifest,
  operation: "search",
  run: (_input, host) => ${call}.pipe(Effect.as({ items: [] })),
});
`;

const searchLayer = (source: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const scripts = yield* RealSandboxScripts;
			const installed = yield* scripts.install(source);
			return ProviderEntitySearchService.layer.pipe(
				Layer.provideMerge(
					Layer.mock(PluginRuntimeResolver)({
						resolveConfigKeyLabels: (_revisionId, keys) =>
							Effect.succeed(keys.map((key) => (key === "apiKey" ? "Example API key" : key))),
						findProviderAvailableToUser: () =>
							Effect.succeed({
								id: providerId,
								name: "Failing",
								createdAt: new Date(0),
								updatedAt: new Date(0),
								slug: "failing.provider",
								pluginScope: "user" as const,
								rootEntitySchemaSlug: "record",
								information: { source: "failing" },
								pluginId: installed.pluginRevision.id,
							}),
						resolveUserSearchScript: () =>
							Effect.succeed({
								source,
								providerId,
								compiledFormat: 1,
								optionsSchema: null,
								id: installed.scriptId,
								name: "Failing search",
								slug: "failing.search",
								createdAt: new Date(0),
								contentHash: installed.contentHash,
								pluginId: installed.pluginRevision.id,
								metadata: installed.compiled.manifest,
								compiledCode: installed.compiled.javascript,
								pluginRevisionId: installed.pluginRevision.revisionId,
							}),
					}),
				),
			);
		}),
	);

const failingHost = (hostResult: ReturnType<typeof durableHostFailure>) =>
	realSandboxLayer({ hostResult });

const search = Effect.gen(function* () {
	const service = yield* ProviderEntitySearchService;
	return yield* Effect.flip(
		service.search(user, { page: 1, providerId, pageSize: 20, query: "needle" }),
	);
});

layer(
	searchLayer(providerSource('host.httpCall("GET", "https://example.test/search")')).pipe(
		Layer.provideMerge(
			failingHost(
				durableHostFailure("Request failed with status 403", {
					status: 403,
					headers: {},
					body: "forbidden",
				}),
			),
		),
	),
	{ excludeTestServices: true },
)((test) => {
	test.effect(
		"reports a provider-error cause when the provider's http call fails with a status",
		() =>
			Effect.gen(function* () {
				const error = yield* search;
				expect(error).toBeInstanceOf(ProviderEntityBadRequest);
				expect(error).toMatchObject({
					reason: { code: "search-failed", cause: { code: "provider-error" } },
				});
			}),
		30_000,
	);
});

layer(
	searchLayer(providerSource('host.getPluginConfig({ required: ["apiKey"] })')).pipe(
		Layer.provideMerge(
			failingHost(
				durableHostFailure('Plugin config key "apiKey" is not configured for this execution', {
					keys: ["apiKey"],
					code: "missing-required-config",
				}),
			),
		),
	),
	{ excludeTestServices: true },
)((test) => {
	test.effect(
		"reports a missing-config cause naming the configuration field",
		() =>
			Effect.gen(function* () {
				const error = yield* search;
				expect(error).toMatchObject({
					reason: {
						code: "search-failed",
						cause: { code: "missing-config", configNames: ["Example API key"] },
					},
				});
			}),
		30_000,
	);
});
