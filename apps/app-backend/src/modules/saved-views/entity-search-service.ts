import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound, unknownToMessage } from "@ryot/contract/errors";
import type {
	SearchSavedViewEntitiesBody,
	SearchSavedViewEntitiesResponse,
} from "@ryot/contract/modules/saved-views/schemas";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { decodeProviderSearchResult } from "#modules/sandbox/provider-contracts";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { SavedViewsRepository } from "./repository";

const unavailableScript = (scriptSlug: string) =>
	badRequest(`Saved view search script '${scriptSlug}' is missing, inactive, or invalid`);

type ProviderResult = SearchSavedViewEntitiesResponse["providers"][number];

export class SavedViewEntitySearchService extends Context.Service<SavedViewEntitySearchService>()(
	"SavedViewEntitySearchService",
	{
		make: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const sandbox = yield* SandboxExecutionService;
			const repository = yield* SavedViewsRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;

			const search = Effect.fn("SavedViewEntitySearchService.search")(function* (
				user: CurrentUserValue,
				viewSlug: string,
				input: SearchSavedViewEntitiesBody,
			) {
				const savedView = yield* runWithDb(repository.findBySlug(user.id, viewSlug));
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
								input,
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
				return { providers } satisfies SearchSavedViewEntitiesResponse;
			});

			return { search };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
