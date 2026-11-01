import { unknownToMessage } from "@ryot-app/contract/errors";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect, toSandboxJsonValue } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type UserSandboxRunInput,
} from "#modules/scripts/authorization/capabilities";
import { principalOwner } from "#modules/scripts/authorization/principal";
import {
	sandboxDefinitionReadContext,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";

import { DefinitionRepository } from "./repository";

const requireNonEmptyString = (value: string, message: string): Effect.Effect<string, string> => {
	if (value.trim().length === 0) {
		return Effect.fail(message);
	}

	return Effect.succeed(value.trim());
};

const requireUniqueNonEmptyStrings = (values: ReadonlyArray<string>, message: string) =>
	Effect.forEach(values, (value) => requireNonEmptyString(value, message)).pipe(
		Effect.map((strings) => [...new Set(strings)]),
	);

export const readScriptEntitySchemas = (
	definitions: DefinitionRepository["Service"],
	input: UserSandboxRunInput,
	slugs: ReadonlyArray<string>,
) => {
	const userId = UserId.make(userSandboxRunUserId(input));
	const context = sandboxDefinitionReadContext(input);
	return context
		? definitions
				.getSnapshotForContext(context, userId)
				.pipe(Effect.map((snapshot) => snapshot.entitySchemas))
		: definitions.findUserEntitySchemas(
				userId,
				slugs.map((slug) => ({ slug, owner: definitionOwner(null) })),
			);
};

export const makeDefinitionScriptHost = Effect.gen(function* () {
	const definitions = yield* DefinitionRepository;
	const pluginRuntime = yield* PluginRuntimeResolver;
	const readEntitySchemas = (input: UserSandboxRunInput, slugs: ReadonlyArray<string>) =>
		readScriptEntitySchemas(definitions, input, slugs);

	return {
		listEventSchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "listEventSchemas").pipe(
				Effect.flatMap((input) =>
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"listEventSchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return readEntitySchemas(input, resolvedEntitySchemaSlugs).pipe(
								Effect.flatMap((entitySchemas) =>
									Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
										const entitySchema =
											entitySchemas[
												definitionKey("entity", principalOwner(input.principal), entitySchemaSlug)
											];
										return entitySchema
											? Effect.succeed(
													Object.values(entitySchema.eventSchemas).map((eventSchema) => ({
														entitySchemaSlug,
														id: eventSchema.slug,
														slug: eventSchema.slug,
														name: eventSchema.name,
														propertiesSchema: toSandboxJsonValue(eventSchema.propertiesSchema),
														pluginId:
															eventSchema.pluginId === null
																? null
																: PluginId.make(eventSchema.pluginId),
													})),
												)
											: Effect.fail("Entity schema not found");
									}).pipe(Effect.map((schemas) => schemas.flat())),
								),
							);
						}),
					),
				),
				sandboxHostEffect,
			),
		getEntitySchemas: (rawInput, entitySchemaSlugs) =>
			requireSandboxCapabilityInput(rawInput, "getEntitySchemas").pipe(
				Effect.flatMap((input) =>
					requireUniqueNonEmptyStrings(
						entitySchemaSlugs,
						"getEntitySchemas expects non-empty entitySchemaSlugs",
					).pipe(
						Effect.flatMap((resolvedEntitySchemaSlugs) => {
							if (resolvedEntitySchemaSlugs.length === 0) {
								return Effect.succeed([]);
							}

							return readEntitySchemas(input, resolvedEntitySchemaSlugs).pipe(
								Effect.flatMap((entitySchemas) =>
									Effect.forEach(resolvedEntitySchemaSlugs, (entitySchemaSlug) => {
										const definition =
											entitySchemas[
												definitionKey("entity", principalOwner(input.principal), entitySchemaSlug)
											];
										if (!definition) {
											return Effect.fail("Entity schema not found");
										}
										return Effect.succeed({ definition, entitySchemaSlug });
									}),
								),
								Effect.flatMap((schemas) =>
									Effect.gen(function* () {
										const links = yield* pluginRuntime.listSchemaProviders({
											userId: userSandboxRunUserId(input),
											entitySchemas: resolvedEntitySchemaSlugs.map((slug) => ({
												slug: EntitySchemaSlug.make(slug),
												owner: principalOwner(input.principal),
											})),
										});
										const providersBySchema = new Map<
											string,
											Array<{ name: string; providerId: string }>
										>();
										for (const { provider, entitySchemaSlug } of links) {
											const providers = providersBySchema.get(entitySchemaSlug) ?? [];
											providers.push({ name: provider.name, providerId: provider.id });
											providersBySchema.set(entitySchemaSlug, providers);
										}

										return schemas.map(({ definition, entitySchemaSlug }) => ({
											isBuiltin: true,
											id: entitySchemaSlug,
											icon: definition.icon,
											name: definition.name,
											slug: definition.slug,
											providers: providersBySchema.get(entitySchemaSlug) ?? [],
											propertiesSchema: toSandboxJsonValue(definition.propertiesSchema),
											pluginId:
												definition.pluginId === null ? null : PluginId.make(definition.pluginId),
										}));
									}).pipe(Effect.mapError(unknownToMessage)),
								),
							);
						}),
					),
				),
				sandboxHostEffect,
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "getEntitySchemas" | "listEventSchemas">;
});
