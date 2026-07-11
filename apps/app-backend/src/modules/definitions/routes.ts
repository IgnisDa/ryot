import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { DefinitionsService } from "./service";

export const DefinitionsRoutesLive = HttpApiBuilder.group(AppContract, "definitions", (handlers) =>
	handlers
		.handle("listEntities", () =>
			Effect.gen(function* () {
				const runWithDb = yield* DbRunner;
				const registry = yield* DefinitionRegistry;
				const pluginRuntime = yield* PluginRuntimeResolver;
				const schemaProviders = yield* runWithDb(pluginRuntime.listSchemaProviders()).pipe(
					dieOnDbError,
				);
				return Object.values(registry.getSnapshot().entitySchemas).map((definition) =>
					Object.assign({}, definition, {
						eventSchemas: Object.values(definition.eventSchemas),
						providers: schemaProviders
							.filter(({ entitySchemaSlug }) => entitySchemaSlug === definition.slug)
							.map(({ provider }) => ({ name: provider.name, providerId: provider.id })),
					}),
				);
			}),
		)
		.handle("listRelationships", () =>
			Effect.gen(function* () {
				const registry = yield* DefinitionRegistry;
				return Object.values(registry.getSnapshot().relationshipSchemas);
			}),
		)
		.handle("listWorkspaces", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* DefinitionsService;
				return yield* service.listWorkspaces(user, urlParams.includeDisabled).pipe(dieOnDbError);
			}),
		)
		.handle("updateWorkspaceState", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* DefinitionsService;
				return yield* service
					.updateWorkspaceState(user, path.pluginSlug, payload)
					.pipe(dieOnDbError);
			}),
		),
);
