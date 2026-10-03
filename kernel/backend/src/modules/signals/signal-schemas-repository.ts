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

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { SignalSchemaDefinition } from "#modules/definition-registry/snapshot";

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

const toScope = (definition: SignalSchemaDefinition): SignalSchemaScope => ({
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
});

const toNullableScope = (definition: SignalSchemaDefinition | null) =>
	definition ? toScope(definition) : null;

export class SignalSchemasRepository extends Context.Service<SignalSchemasRepository>()(
	"SignalSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const scope = (slug: string) =>
				definitions.findGlobalSignalSchema(slug).pipe(Effect.map(toNullableScope));
			const findGlobalBySlug = scope;
			const findVisibleBySlug = (input: { slug: string; userId: UserId | null }) =>
				input.userId === null
					? scope(input.slug)
					: definitions
							.findUserSignalSchema(input.userId, input.slug)
							.pipe(Effect.map(toNullableScope));
			const findBuiltinById = (id: SignalSchemaSlug) => scope(id);
			const findActiveBuiltinById = (id: SignalSchemaSlug) =>
				scope(id).pipe(Effect.map((value) => (value?.catalogState === "active" ? value : null)));
			const listActiveBuiltins = definitions
				.listGlobalSignalSchemas()
				.pipe(
					Effect.map((signals) =>
						signals.flatMap((signal) =>
							signal.catalogState === "active" ? [toScope(signal)] : [],
						),
					),
				);
			const insertBuiltin = Effect.fn(function* (input: BuiltinSignalSchemaInput) {
				return (
					(yield* scope(input.slug)) ?? {
						...input,
						userId: null,
						id: SignalSchemaSlug.make(input.slug),
					}
				);
			});
			const updateBuiltinDisplay = (input: {
				id: SignalSchemaSlug;
				name: string;
				catalogState: SignalCatalogState;
			}) => scope(input.id);
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
