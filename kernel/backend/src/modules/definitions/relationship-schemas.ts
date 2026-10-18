import type {
	PluginProjection,
	PluginRelationshipUserWritePolicy,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { RelationshipSchemaDefinition } from "#modules/definitions/snapshot";

type RelationshipSchemaScope = {
	readonly name: string;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly pluginId: null | string;
	readonly id: RelationshipSchemaSlug;
	readonly propertiesSchema: AppSchema;
	readonly projection?: undefined | PluginProjection;
	readonly sourceEntitySchemaSlug: null | EntitySchemaSlug;
	readonly targetEntitySchemaSlug: null | EntitySchemaSlug;
	readonly userWritePolicy?: undefined | PluginRelationshipUserWritePolicy;
};

const toNullableScope = (definition: null | undefined | RelationshipSchemaDefinition) =>
	definition ? toScope(definition) : null;

export class RelationshipSchemaReader extends Context.Service<RelationshipSchemaReader>()(
	"RelationshipSchemaReader",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const findByReference = (reference: RelationshipSchemaReference, userId: null | UserId) =>
				userId === null
					? definitions.findGlobalRelationshipSchema(reference).pipe(Effect.map(toNullableScope))
					: definitions
							.findUserRelationshipSchemas(userId, [reference])
							.pipe(
								Effect.map((found) =>
									toNullableScope(
										found[definitionKey("relationship", reference.owner, reference.slug)],
									),
								),
							);
			const findKernelBySlug = (slug: string) =>
				definitions
					.findGlobalRelationshipSchema({
						owner: { kind: "kernel" },
						slug: RelationshipSchemaSlug.make(slug),
					})
					.pipe(Effect.map(toNullableScope));
			return { findByReference, findKernelBySlug };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const toScope = (definition: RelationshipSchemaDefinition): RelationshipSchemaScope => ({
	name: definition.name,
	slug: definition.slug,
	pluginId: definition.pluginId,
	isBuiltin: definition.pluginId === null,
	propertiesSchema: definition.propertiesSchema,
	id: RelationshipSchemaSlug.make(definition.slug),
	sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug
		? EntitySchemaSlug.make(definition.sourceEntitySchemaSlug)
		: null,
	targetEntitySchemaSlug: definition.targetEntitySchemaSlug
		? EntitySchemaSlug.make(definition.targetEntitySchemaSlug)
		: null,
	...(definition.projection === undefined ? {} : { projection: definition.projection }),
	...(definition.userWritePolicy === undefined
		? {}
		: { userWritePolicy: definition.userWritePolicy }),
});
