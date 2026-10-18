import type {
	EntityEditorSaveOutput,
	EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import type {
	ImportEntityBody,
	SearchProviderEntitiesBody,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import {
	entityPickerEntitiesRecipe,
	entityPickerMaterializedRecipe,
	entityPickerSchemaRecipe,
} from "@ryot-app/ryotql-recipes/entity-picker";
import { providerEntityLinksRecipe } from "@ryot-app/ryotql-recipes/provider-entity-links";
import { providerSearchRecipe } from "@ryot-app/ryotql-recipes/provider-search";
import type { ProviderSearchResult } from "@ryot-app/ryotql-recipes/provider-search";
import { Context, Data, Effect, Layer } from "effect";

import { isDemoOperationProtectedError } from "#/api/authenticated";
import { EntitiesApi, isDeclaredEntitySaveFailure } from "#/api/entities";
import { EntityProvidersApi } from "#/api/entity-providers";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import { DEMO_PROTECTION_MESSAGE } from "#/modules/demo-protection";

export type ProviderSearchSummary = ProviderSearchResult["items"][number];

type ProviderAddClient = Pick<KernelRyotClient, "data">;

export class ProviderAddLoadError extends Data.TaggedError("ProviderAddLoadError")<{
	readonly cause: unknown;
	readonly stage:
		"links" | "search" | "import" | "schema" | "create" | "options" | "entities" | "providers";
}> {}

const query = <A, E>(stage: ProviderAddLoadError["stage"], effect: Effect.Effect<A, E>) =>
	effect.pipe(Effect.mapError((cause) => new ProviderAddLoadError({ cause, stage })));

export const ENTITY_CREATE_REFUSED_MESSAGE = "This item could not be created here.";

export class ProviderAddService extends Context.Service<ProviderAddService>()(
	"ProviderAddService",
	{
		make: Effect.gen(function* () {
			const api = yield* EntityProvidersApi;
			const entities = yield* EntitiesApi;
			const loadSchema = Effect.fn("ProviderAddService.loadSchema")(function* (
				client: ProviderAddClient,
				schema: EntitySchemaReference,
			) {
				return yield* query("schema", client.data.query(entityPickerSchemaRecipe({ schema })));
			});
			const loadEntities = Effect.fn("ProviderAddService.loadEntities")(function* (
				client: ProviderAddClient,
				input: Parameters<typeof entityPickerEntitiesRecipe>[0],
			) {
				return yield* query("entities", client.data.query(entityPickerEntitiesRecipe(input)));
			});
			const loadMaterialized = Effect.fn("ProviderAddService.loadMaterialized")(function* (
				client: ProviderAddClient,
				input: Parameters<typeof entityPickerMaterializedRecipe>[0],
			) {
				return yield* query("links", client.data.query(entityPickerMaterializedRecipe(input)));
			});
			const createEntity = Effect.fn("ProviderAddService.createEntity")(function* (
				scope: ApiScope,
				payload: EntityEditorSaveRequest,
			) {
				return yield* entities.saveEditor(scope, { payload }).pipe(
					Effect.map(({ output }) => output),
					Effect.catch((cause) => {
						if (isDemoOperationProtectedError(cause)) {
							return Effect.succeed<EntityEditorSaveOutput>({
								kind: "invalid",
								message: DEMO_PROTECTION_MESSAGE,
							});
						}
						return isDeclaredEntitySaveFailure(cause)
							? Effect.succeed<EntityEditorSaveOutput>({
									kind: "invalid",
									message: ENTITY_CREATE_REFUSED_MESSAGE,
								})
							: Effect.fail(new ProviderAddLoadError({ cause, stage: "create" }));
					}),
				);
			});
			const loadProviders = Effect.fn("ProviderAddService.loadProviders")(function* (
				client: ProviderAddClient,
				rootEntitySchema: EntitySchemaReference,
			) {
				return yield* client.data
					.query(providerSearchRecipe({ schema: rootEntitySchema }))
					.pipe(
						Effect.mapError((cause) => new ProviderAddLoadError({ cause, stage: "providers" })),
					);
			});
			const loadEntityLinks = Effect.fn("ProviderAddService.loadEntityLinks")(function* (
				client: ProviderAddClient,
				input: Parameters<typeof providerEntityLinksRecipe>[0],
			) {
				return yield* client.data
					.query(providerEntityLinksRecipe(input))
					.pipe(Effect.mapError((cause) => new ProviderAddLoadError({ cause, stage: "links" })));
			});
			const loadSearchOptions = Effect.fn("ProviderAddService.loadSearchOptions")(function* (
				scope: ApiScope,
				providerId: SandboxProviderId,
			) {
				return yield* api
					.searchOptions(scope, { payload: { providerId } })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ stage: "options", cause: error.cause }),
						),
					);
			});
			const search = Effect.fn("ProviderAddService.search")(function* (
				scope: ApiScope,
				payload: SearchProviderEntitiesBody,
			) {
				return yield* api
					.search(scope, { payload })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ stage: "search", cause: error.cause }),
						),
					);
			});
			const startImport = Effect.fn("ProviderAddService.startImport")(function* (
				scope: ApiScope,
				payload: ImportEntityBody,
			) {
				return yield* api
					.import(scope, { payload })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ stage: "import", cause: error.cause }),
						),
					);
			});
			const pollImport = Effect.fn("ProviderAddService.pollImport")(function* (
				scope: ApiScope,
				jobId: string,
			) {
				return yield* api
					.getImportResult(scope, { params: { jobId } })
					.pipe(
						Effect.mapError(
							(error) => new ProviderAddLoadError({ stage: "import", cause: error.cause }),
						),
					);
			});

			return {
				search,
				loadSchema,
				pollImport,
				startImport,
				createEntity,
				loadEntities,
				loadProviders,
				loadEntityLinks,
				loadMaterialized,
				loadSearchOptions,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
