import type {
	SignalAudiencePolicy,
	SignalCatalogState,
} from "@ryot-app/contract/modules/automations/schemas";
import {
	RelationshipSchemaSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

export type SignalSchemaScope = {
	slug: string;
	name: string;
	id: SignalSchemaSlug;
	userId: UserId | null;
	propertiesSchema: AppSchema;
	catalogState: SignalCatalogState;
	pluginId?: string | null | undefined;
	audiencePolicy: SignalAudiencePolicy;
};

export type BuiltinSignalSchemaInput = Pick<
	SignalSchemaScope,
	"audiencePolicy" | "catalogState" | "name" | "propertiesSchema" | "slug"
>;

export class SignalSchemasRepository extends Context.Service<SignalSchemasRepository>()(
	"SignalSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const scope = (slug: string): SignalSchemaScope | null => {
				const definition = definitions.getSignalSchema(slug);
				return definition
					? {
							...definition,
							userId: null,
							id: SignalSchemaSlug.make(definition.slug),
							audiencePolicy:
								definition.audiencePolicy.kind === "actor"
									? definition.audiencePolicy
									: {
											...definition.audiencePolicy,
											relationshipSchemaSlug: RelationshipSchemaSlug.make(
												definition.audiencePolicy.relationshipSchemaSlug,
											),
										},
						}
					: null;
			};
			const findGlobalBySlug = (slug: string) => Effect.succeed(scope(slug));
			const findVisibleBySlug = (input: { slug: string; userId: UserId | null }) =>
				input.userId === null
					? Effect.succeed(scope(input.slug))
					: pluginRuntime.getEffectiveDefinitions(input.userId).pipe(
							Effect.map((effective) => {
								const definition = effective.signalSchemas[input.slug];
								return definition
									? {
											...definition,
											userId: null,
											id: SignalSchemaSlug.make(definition.slug),
											audiencePolicy:
												definition.audiencePolicy.kind === "actor"
													? definition.audiencePolicy
													: {
															...definition.audiencePolicy,
															relationshipSchemaSlug: RelationshipSchemaSlug.make(
																definition.audiencePolicy.relationshipSchemaSlug,
															),
														},
										}
									: null;
							}),
						);
			const findBuiltinById = (id: SignalSchemaSlug) => Effect.succeed(scope(id));
			const findActiveBuiltinById = (id: SignalSchemaSlug) =>
				Effect.succeed(scope(id)?.catalogState === "active" ? scope(id) : null);
			const listActiveBuiltins = Effect.succeed(
				Object.keys(definitions.getSnapshot().signalSchemas).flatMap((slug) => {
					const value = scope(slug);
					return value?.catalogState === "active" ? [value] : [];
				}),
			);
			const insertBuiltin = (input: BuiltinSignalSchemaInput) =>
				Effect.succeed(
					scope(input.slug) ?? { ...input, userId: null, id: SignalSchemaSlug.make(input.slug) },
				);
			const updateBuiltinDisplay = (input: {
				id: SignalSchemaSlug;
				name: string;
				catalogState: SignalCatalogState;
			}) => Effect.succeed(scope(input.id));
			return {
				insertBuiltin,
				findBuiltinById,
				findGlobalBySlug,
				findVisibleBySlug,
				listActiveBuiltins,
				updateBuiltinDisplay,
				findActiveBuiltinById,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
