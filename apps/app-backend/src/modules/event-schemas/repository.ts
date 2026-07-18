import { EntitySchemaSlug, EventSchemaSlug, type UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import {
	DefinitionRegistry,
	type EventSchemaDefinition,
} from "#modules/definition-registry/service";

const toListed = (entitySchemaSlug: string, event: EventSchemaDefinition) => ({
	id: EventSchemaSlug.make(event.slug),
	slug: event.slug,
	name: event.name,
	propertiesSchema: event.propertiesSchema,
	entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
});

export class EventSchemasRepository extends Context.Service<EventSchemasRepository>()(
	"EventSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const getEntitySchemaScopeById = (input: {
				entitySchemaSlug: EntitySchemaSlug;
				userId: UserId;
			}) => {
				const definition = definitions.getEntitySchema(input.entitySchemaSlug);
				return Effect.succeed(
					definition
						? { userId: null, isBuiltin: true, slug: definition.slug, id: input.entitySchemaSlug }
						: null,
				);
			};
			const getBuiltinBySlug = (input: { entitySchemaSlug: EntitySchemaSlug; slug: string }) => {
				const event = definitions.getEventSchema(input.entitySchemaSlug, input.slug);
				return Effect.succeed(
					event
						? { id: EventSchemaSlug.make(event.slug), propertiesSchema: event.propertiesSchema }
						: null,
				);
			};
			const listByEntitySchemaForUser = (input: {
				entitySchemaSlug: EntitySchemaSlug;
				userId: UserId;
			}) => {
				const entity = definitions.getEntitySchema(input.entitySchemaSlug);
				return Effect.succeed(
					entity
						? Object.values(entity.eventSchemas).map((event) =>
								toListed(input.entitySchemaSlug, event),
							)
						: [],
				);
			};
			const getScopeForUser = (input: {
				userId: UserId;
				eventSchemaSlug: EventSchemaSlug;
				entitySchemaSlug: EntitySchemaSlug;
			}) => {
				const entity = definitions.getEntitySchema(input.entitySchemaSlug);
				const event = entity?.eventSchemas[input.eventSchemaSlug];
				return Effect.succeed(event ? toListed(input.entitySchemaSlug, event) : null);
			};

			return {
				getScopeForUser,
				getBuiltinBySlug,
				getEntitySchemaScopeById,
				listByEntitySchemaForUser,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
