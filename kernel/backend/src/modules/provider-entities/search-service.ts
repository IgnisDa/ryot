import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import {
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	materializeAppSchemaChoices,
	type AppSchema,
} from "@ryot-app/contract/schema/property-schema";
import {
	providerSearchOptionsResultSchema,
	providerSearchResultSchema,
} from "@ryot-app/sandbox-sdk/provider";
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
import { SandboxExecutionService } from "#modules/sandbox/service";

const decodeProviderSearchResult = Schema.decodeUnknownEffect(providerSearchResultSchema);
const providerNotFound = (providerId: SearchProviderEntitiesBody["providerId"]) =>
	new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } });
const decodeCachedSources = (value: string | null) => {
	if (value === null) {
		return null;
	}
	const decoded = Schema.decodeUnknownResult(
		Schema.fromJsonString(providerSearchOptionsResultSchema),
	)(value);
	return Result.isSuccess(decoded) ? decoded.success.sources : null;
};

export class ProviderEntitySearchService extends Context.Service<ProviderEntitySearchService>()(
	"ProviderEntitySearchService",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;
			const sandbox = yield* SandboxExecutionService;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const resolveSearch = Effect.fn("ProviderEntitySearchService.resolveSearch")(function* (
				userId: CurrentUserValue["id"],
				providerId: SearchProviderEntitiesBody["providerId"],
			) {
				const provider = yield* pluginRuntime.findProviderAvailableToUser(userId, providerId);
				if (!provider) {
					return yield* providerNotFound(providerId);
				}

				const resolved = yield* pluginRuntime.resolveUserSearchScript(userId, providerId).pipe(
					Effect.mapError((error) => {
						if (!(error instanceof UnsupportedProviderOperationError)) {
							return error;
						}
						if (error.reason === "inactive_provider") {
							return providerNotFound(providerId);
						}
						return new ProviderEntityBadRequest({
							reason: { providerId, code: "search-unsupported" },
						});
					}),
				);
				return { provider, resolved };
			});

			const materializeSearchOptionsSchema = Effect.fn(
				"ProviderEntitySearchService.materializeSearchOptionsSchema",
			)(function* (
				user: CurrentUserValue,
				providerId: SearchProviderEntitiesBody["providerId"],
				optionsSchema: AppSchema,
			) {
				const staticSchema = materializeAppSchemaChoices(optionsSchema, {});
				if (Result.isSuccess(staticSchema)) {
					return staticSchema.success;
				}

				const searchOptionsScript = yield* pluginRuntime
					.resolveUserSearchOptionsScript(user.id, providerId)
					.pipe(
						Effect.tapError((error) =>
							Effect.logError("provider search options script resolution failed", error),
						),
						Effect.mapError((error) =>
							error instanceof UnsupportedProviderOperationError
								? new ProviderEntityBadRequest({ reason: { code: "search-options-unavailable" } })
								: error,
						),
					);
				const cacheKey = redisKeys.providerSearchOptions(providerId, searchOptionsScript.id);
				const cachedSources = decodeCachedSources(yield* redis.get(cacheKey));
				if (cachedSources !== null) {
					const materialized = materializeAppSchemaChoices(optionsSchema, cachedSources);
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
					subject: { type: "user", userId: user.id },
					executionId: `provider-search-options-${generateId()}`,
				});
				if (execution.error) {
					yield* Effect.logError("provider search options execution failed", execution.error);
					return yield* new ProviderEntityBadRequest({
						reason: { code: "search-options-unavailable" },
					});
				}

				const decoded = Schema.decodeUnknownResult(providerSearchOptionsResultSchema)(
					execution.value,
				);
				if (Result.isFailure(decoded)) {
					yield* Effect.logError(
						"provider search options result could not be decoded",
						decoded.failure,
					);
					return yield* new ProviderEntityBadRequest({
						reason: { code: "search-options-unavailable" },
					});
				}
				const materialized = materializeAppSchemaChoices(optionsSchema, decoded.success.sources);
				if (Result.isFailure(materialized)) {
					yield* Effect.logError(
						"provider search options result could not be materialized",
						materialized.failure,
					);
					return yield* new ProviderEntityBadRequest({
						reason: { code: "search-options-unavailable" },
					});
				}
				const encoded = yield* Schema.encodeEffect(
					Schema.fromJsonString(providerSearchOptionsResultSchema),
				)(decoded.success).pipe(Effect.orDie);
				yield* redis.set(cacheKey, encoded, PROVIDER_SEARCH_OPTIONS_CACHE_TTL_SECONDS);
				return materialized.success;
			});

			const resolveSearchOptionsSchema = Effect.fn(
				"ProviderEntitySearchService.resolveSearchOptionsSchema",
			)(function* (user: CurrentUserValue, providerId: SearchProviderEntitiesBody["providerId"]) {
				const { resolved } = yield* resolveSearch(user.id, providerId);
				return resolved.optionsSchema === null
					? null
					: yield* materializeSearchOptionsSchema(user, providerId, resolved.optionsSchema);
			});

			const search = Effect.fn("ProviderEntitySearchService.search")(function* (
				user: CurrentUserValue,
				input: SearchProviderEntitiesBody,
			) {
				const { provider, resolved } = yield* resolveSearch(user.id, input.providerId);
				let options: Record<string, unknown> | undefined;
				if (resolved.optionsSchema === null) {
					if (input.options !== undefined) {
						return yield* new ProviderEntityBadRequest({
							reason: { providerId: input.providerId, code: "search-options-unsupported" },
						});
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
							: yield* materializeSearchOptionsSchema(
									user,
									input.providerId,
									resolved.optionsSchema,
								);
					options = yield* parseAppSchemaProperties({
						propertiesSchema: schema,
						kind: "Provider search options",
						properties: input.options ?? {},
					}).pipe(
						Effect.tapError((error) =>
							Effect.logWarning("invalid provider search options", { issues: error.issues }),
						),
						Effect.mapError(
							() => new ProviderEntityBadRequest({ reason: { code: "invalid-search-options" } }),
						),
					);
				}
				const execution = yield* sandbox.executeScript({
					scriptId: resolved.id,
					subject: { type: "user", userId: user.id },
					executionId: `provider-search-${generateId()}`,
					input: {
						page: input.page,
						query: input.query,
						pageSize: input.pageSize,
						...(options === undefined ? {} : { options }),
					},
				});
				if (execution.error) {
					yield* Effect.logError("provider search execution failed", execution.error);
					return yield* new ProviderEntityBadRequest({ reason: { code: "search-failed" } });
				}
				const result = yield* decodeProviderSearchResult(execution.value).pipe(
					Effect.tapError((error) => Effect.logError("invalid provider search result", error)),
					Effect.mapError(
						() => new ProviderEntityBadRequest({ reason: { code: "invalid-search-result" } }),
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

			return { search, resolveSearchOptionsSchema };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
