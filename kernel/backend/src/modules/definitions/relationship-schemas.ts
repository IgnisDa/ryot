import type { PluginRelationshipUserWritePolicy } from "@ryot-app/contract/modules/plugins/manifest";
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
import type {
	DefinitionProjection,
	RelationshipSchemaDefinition,
} from "@ryot-app/definitions/snapshot";
import type { Message } from "@ryot-app/i18n/message";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { definitionText } from "#modules/definitions/text";

type RelationshipSchemaScope = {
	readonly slug: string;
	readonly name: Message;
	readonly isBuiltin: boolean;
	readonly pluginId: null | string;
	readonly id: RelationshipSchemaSlug;
	readonly propertiesSchema: AppSchema;
	readonly projection?: undefined | DefinitionProjection;
	readonly sourceEntitySchemaSlug: null | EntitySchemaSlug;
	readonly targetEntitySchemaSlug: null | EntitySchemaSlug;
	readonly userWritePolicy?: undefined | PluginRelationshipUserWritePolicy;
};

const toNullableScope = (definition: null | undefined | RelationshipSchemaDefinition) =>
	definition ? toScope(definition) : null;

export class RelationshipSchemaReader extends Context.Service<RelationshipSchemaReader>()(
	"@ryot-app/kernel-backend/modules/definitions/relationship-schemas/RelationshipSchemaReader",
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
	slug: definition.slug,
	pluginId: definition.pluginId,
	isBuiltin: definition.pluginId === null,
	propertiesSchema: definition.propertiesSchema,
	id: RelationshipSchemaSlug.make(definition.slug),
	name: definitionText(definition.pluginId, definition.name),
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
