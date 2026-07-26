import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound, unknownToMessage } from "@ryot/contract/errors";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot/contract/modules/provider-entities/schemas";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { decodeProviderSearchResult } from "#modules/sandbox/provider-contracts";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SavedViewsRepository } from "#modules/saved-views/repository";

const unavailableScript = (scriptSlug: string) =>
	badRequest(`Saved view search script '${scriptSlug}' is missing, inactive, or invalid`);

type ProviderResult = SearchProviderEntitiesResponse["providers"][number];

export class ProviderEntitySearchService extends Context.Service<ProviderEntitySearchService>()(
	"ProviderEntitySearchService",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const sandbox = yield* SandboxExecutionService;
			const repository = yield* SavedViewsRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const search = Effect.fn("ProviderEntitySearchService.search")(function* (
				user: CurrentUserValue,
				input: SearchProviderEntitiesBody,
			) {
				const savedView = yield* runWithDb(repository.findBySlug(user.id, input.savedViewSlug));
				if (!savedView) {
					return yield* notFound("Saved view not found");
				}
				const resolved = yield* Effect.forEach(
					savedView.sandboxScripts["search"] ?? [],
					(scriptSlug) =>
						runWithDb(pluginRuntime.resolveSavedViewSearchScript(scriptSlug)).pipe(
							Effect.flatMap((value) =>
								value ? Effect.succeed(value) : unavailableScript(scriptSlug),
							),
						),
				);
				const providers = yield* Effect.forEach(
					resolved,
					({ entitySchemaSlug, provider, script }) => {
						const provenance = {
							entitySchemaSlug,
							providerId: provider.id,
							providerName: provider.name,
						};
						const failed = (error: unknown): ProviderResult => ({
							...provenance,
							status: "failure",
							error: unknownToMessage(error),
						});
						return sandbox
							.executeScript({
								input: {
									query: input.query,
									page: input.page,
									pageSize: input.pageSize,
								},
								scriptId: script.id,
								authority: { type: "user", userId: user.id },
								executionId: `saved-view-search-${generateId()}`,
							})
							.pipe(
								Effect.flatMap((execution) => {
									if (execution.error) {
										return Effect.succeed(
											failed(`${execution.error.phase}: ${execution.error.message}`),
										);
									}
									return decodeProviderSearchResult(execution.value).pipe(
										Effect.map(
											(result): ProviderResult => ({ ...result, ...provenance, status: "success" }),
										),
									);
								}),
								Effect.catch((error) => Effect.succeed(failed(error))),
							);
					},
					{ concurrency: "unbounded" },
				);
				return { providers } satisfies SearchProviderEntitiesResponse;
			});

			return { search };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
