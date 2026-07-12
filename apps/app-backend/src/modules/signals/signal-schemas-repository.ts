import type {
	SignalAudiencePolicy,
	SignalCatalogState,
} from "@ryot/contract/modules/automations/schemas";
import {
	RelationshipSchemaSlug,
	SignalSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

export type SignalSchemaScope = {
	slug: string;
	name: string;
	id: SignalSchemaSlug;
	userId: UserId | null;
	propertiesSchema: AppSchema;
	catalogState: SignalCatalogState;
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
			const scope = (slug: string): SignalSchemaScope | null => {
				const definition = definitions.getSignalSchema(slug);
				return definition
					? {
							...definition,
							audiencePolicy:
								definition.audiencePolicy.kind === "actor"
									? definition.audiencePolicy
									: {
											...definition.audiencePolicy,
											relationshipSchemaSlug: RelationshipSchemaSlug.make(
												definition.audiencePolicy.relationshipSchemaSlug,
											),
										},
							id: SignalSchemaSlug.make(definition.slug),
							userId: null,
						}
					: null;
			};
			const findGlobalBySlug = (slug: string) => Effect.succeed(scope(slug));
			const findVisibleBySlug = (input: { slug: string; userId: UserId | null }) =>
				Effect.succeed(scope(input.slug));
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
					scope(input.slug) ?? {
						...input,
						id: SignalSchemaSlug.make(input.slug),
						userId: null,
					},
				);
			const updateBuiltinDisplay = (input: {
				id: SignalSchemaSlug;
				name: string;
				catalogState: SignalCatalogState;
			}) => Effect.succeed(scope(input.id));
			return {
				insertBuiltin,
				listActiveBuiltins,
				findBuiltinById,
				findGlobalBySlug,
				findVisibleBySlug,
				updateBuiltinDisplay,
				findActiveBuiltinById,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
