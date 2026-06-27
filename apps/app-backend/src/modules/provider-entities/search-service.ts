import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { materializeAppSchemaChoices } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Result, Schema } from "effect";

import {
	PROVIDER_SEARCH_OPTIONS_CACHE_TTL_SECONDS,
	redisKeys,
	RedisService,
} from "#lib/infrastructure/redis";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import {
	PluginRuntimeResolver,
	UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import {
	ProviderSearchOptionsResultSchema,
	decodeProviderSearchResult,
} from "#modules/sandbox/provider-contracts";
import { SandboxExecutionService } from "#modules/sandbox/service";

const providerNotFound = () => notFound("Provider not found");
const searchOptionsResolutionError = "Provider search options could not be resolved";
const decodeCachedSources = (value: string | null) => {
	if (value === null) {
		return null;
	}
	const decoded = Schema.decodeUnknownResult(
		Schema.fromJsonString(ProviderSearchOptionsResultSchema),
	)(value);
	return Result.isSuccess(decoded) ? decoded.success.sources : null;
};

/** @effect-expect-leaking Database */
export class ProviderEntitySearchService extends Context.Service<ProviderEntitySearchService>()(
	"ProviderEntitySearchService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const sandbox = yield* SandboxExecutionService;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const resolveSearch = Effect.fn("ProviderEntitySearchService.resolveSearch")(function* (
				providerId: SearchProviderEntitiesBody["providerId"],
			) {
				const provider = yield* pluginRuntime.findActiveProviderById(providerId);
				if (!provider) {
					return yield* providerNotFound();
				}

				const resolved = yield* pluginRuntime.resolveSearchScript(providerId).pipe(
					Effect.mapError((error) => {
						if (!(error instanceof UnsupportedProviderOperationError)) {
							return error;
						}
						if (error.reason === "inactive_provider") {
							return providerNotFound();
						}
						return badRequest(`Provider '${provider.name}' does not support search`);
					}),
				);
				return { provider, resolved };
			});

			const resolveSearchOptionsSchema = Effect.fn(
				"ProviderEntitySearchService.resolveSearchOptionsSchema",
			)(function* (user: CurrentUserValue, providerId: SearchProviderEntitiesBody["providerId"]) {
				const { provider, resolved } = yield* resolveSearch(providerId);
				if (resolved.optionsSchema === null) {
					return null;
				}

				const staticSchema = materializeAppSchemaChoices(resolved.optionsSchema, {});
				if (Result.isSuccess(staticSchema)) {
					return staticSchema.success;
				}

				const searchOptionsScript = yield* pluginRuntime
					.resolveSearchOptionsScript(providerId)
					.pipe(
						Effect.tapError((error) =>
							Effect.logError("provider search options script resolution failed", error),
						),
						Effect.mapError((error) =>
							error instanceof UnsupportedProviderOperationError
								? badRequest(searchOptionsResolutionError)
								: error,
						),
					);
				const cacheKey = redisKeys.providerSearchOptions(provider.id, searchOptionsScript.id);
				const cachedSources = decodeCachedSources(yield* redis.get(cacheKey));
				if (cachedSources !== null) {
					const materialized = materializeAppSchemaChoices(resolved.optionsSchema, cachedSources);
					if (Result.isSuccess(materialized)) {
						return materialized.success;
					}
					yield* Effect.logError(
						"cached provider search options could not be materialized",
						materialized.failure,
					);
				}

				const execution = yield* sandbox.executeScript({
					input: {},
					scriptId: searchOptionsScript.id,
					authority: { type: "user", userId: user.id },
					executionId: `provider-search-options-${generateId()}`,
				});
				if (execution.error) {
					yield* Effect.logError("provider search options execution failed", execution.error);
					return yield* badRequest(searchOptionsResolutionError);
				}

				const decoded = Schema.decodeUnknownResult(ProviderSearchOptionsResultSchema)(
					execution.value,
				);
				if (Result.isFailure(decoded)) {
					yield* Effect.logError(
						"provider search options result could not be decoded",
						decoded.failure,
					);
					return yield* badRequest(searchOptionsResolutionError);
				}
				const materialized = materializeAppSchemaChoices(
					resolved.optionsSchema,
					decoded.success.sources,
				);
				if (Result.isFailure(materialized)) {
					yield* Effect.logError(
						"provider search options result could not be materialized",
						materialized.failure,
					);
					return yield* badRequest(searchOptionsResolutionError);
				}
				const encoded = yield* Schema.encodeEffect(
					Schema.fromJsonString(ProviderSearchOptionsResultSchema),
				)(decoded.success).pipe(Effect.orDie);
				yield* redis.set(cacheKey, encoded, PROVIDER_SEARCH_OPTIONS_CACHE_TTL_SECONDS);
				return materialized.success;
			});

			const search = Effect.fn("ProviderEntitySearchService.search")(function* (
				user: CurrentUserValue,
				input: SearchProviderEntitiesBody,
			) {
				const { provider, resolved } = yield* resolveSearch(input.providerId);
				let options: Record<string, unknown> | undefined;
				if (resolved.optionsSchema === null) {
					if (input.options !== undefined) {
						return yield* badRequest("Provider search options are not supported");
					}
				} else if (
					input.options === undefined &&
					Result.isFailure(materializeAppSchemaChoices(resolved.optionsSchema, {}))
				) {
					options = undefined;
				} else {
					const schema =
						input.options === undefined
							? resolved.optionsSchema
							: ((yield* resolveSearchOptionsSchema(user, input.providerId)) ??
								resolved.optionsSchema);
					options = yield* parseAppSchemaProperties({
						kind: "Provider search options",
						properties: input.options ?? {},
						propertiesSchema: schema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));
				}
				const execution = yield* sandbox.executeScript({
					scriptId: resolved.id,
					authority: { type: "user", userId: user.id },
					executionId: `provider-search-${generateId()}`,
					input: {
						page: input.page,
						query: input.query,
						pageSize: input.pageSize,
						...(options === undefined ? {} : { options }),
					},
				});
				if (execution.error) {
					return yield* badRequest(`${execution.error.phase}: ${execution.error.message}`);
				}
				const result = yield* decodeProviderSearchResult(execution.value).pipe(
					Effect.mapError((error) =>
						badRequest(`Invalid provider search result: ${error.message}`),
					),
				);
				return {
					items: result.items,
					providerId: provider.id,
					providerName: provider.name,
					...(result.details ? { details: result.details } : {}),
					rootEntitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
				} satisfies SearchProviderEntitiesResponse;
			});

			return { resolveSearchOptionsSchema, search };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
