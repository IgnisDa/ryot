import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import {
	PluginRuntimeResolver,
	UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import { decodeProviderSearchResult } from "#modules/sandbox/provider-contracts";
import { SandboxExecutionService } from "#modules/sandbox/service";

const providerNotFound = () => notFound("Provider not found");

export class ProviderEntitySearchService extends Context.Service<ProviderEntitySearchService>()(
	"ProviderEntitySearchService",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const sandbox = yield* SandboxExecutionService;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const search = Effect.fn("ProviderEntitySearchService.search")(function* (
				user: CurrentUserValue,
				input: SearchProviderEntitiesBody,
			) {
				const provider = yield* runWithDb(pluginRuntime.findActiveProviderById(input.providerId));
				if (!provider) {
					return yield* providerNotFound();
				}

				const resolved = yield* runWithDb(pluginRuntime.resolveSearchScript(input.providerId)).pipe(
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
				let options: Record<string, unknown> | undefined;
				if (resolved.optionsSchema === null) {
					if (input.options !== undefined) {
						return yield* badRequest("Provider search options are not supported");
					}
				} else {
					options = yield* parseAppSchemaProperties({
						kind: "Provider search options",
						properties: input.options ?? {},
						propertiesSchema: resolved.optionsSchema,
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

			return { search };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
