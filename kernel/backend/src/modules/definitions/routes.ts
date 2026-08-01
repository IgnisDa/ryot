import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PluginInstallationService } from "#modules/plugins/installation-service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { DefinitionsService } from "./service";

export const DefinitionsRoutesLive = HttpApiBuilder.group(AppContract, "definitions", (handlers) =>
	handlers
		.handle("listEntities", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const pluginRuntime = yield* PluginRuntimeResolver;
				const definitions = yield* pluginRuntime
					.getEffectiveDefinitions(user.id)
					.pipe(dieOnDbError);
				const schemaProviders = yield* pluginRuntime
					.listSchemaProviders(undefined, user.id)
					.pipe(dieOnDbError);
				return Object.values(definitions.entitySchemas).map((definition) =>
					Object.assign({}, definition, {
						slug: EntitySchemaSlug.make(definition.slug),
						pluginSlug:
							definition.pluginSlug === null ? null : PluginSlug.make(definition.pluginSlug),
						eventSchemas: Object.values(definition.eventSchemas).map((eventSchema) =>
							Object.assign({}, eventSchema, {
								slug: EventSchemaSlug.make(eventSchema.slug),
							}),
						),
						providers: schemaProviders
							.filter(({ entitySchemaSlug }) => entitySchemaSlug === definition.slug)
							.map(({ provider }) => ({ name: provider.name, providerId: provider.id })),
					}),
				);
			}),
		)
		.handle("listRelationships", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const pluginRuntime = yield* PluginRuntimeResolver;
				const definitions = yield* pluginRuntime
					.getEffectiveDefinitions(user.id)
					.pipe(dieOnDbError);
				return Object.values(definitions.relationshipSchemas).map((definition) =>
					Object.assign({}, definition, {
						slug: RelationshipSchemaSlug.make(definition.slug),
						sourceEntitySchemaSlug:
							definition.sourceEntitySchemaSlug === null
								? null
								: EntitySchemaSlug.make(definition.sourceEntitySchemaSlug),
						targetEntitySchemaSlug:
							definition.targetEntitySchemaSlug === null
								? null
								: EntitySchemaSlug.make(definition.targetEntitySchemaSlug),
					}),
				);
			}),
		)
		.handle("listPlugins", ({ query }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* DefinitionsService;
				return yield* service.listPlugins(user, query.includeDisabled).pipe(dieOnDbError);
			}),
		)
		.handle("updatePluginState", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PluginInstallationService;
				return yield* service
					.updateInstallation(user.id, params.pluginSlug, payload)
					.pipe(dieOnDbError);
			}),
		),
);
