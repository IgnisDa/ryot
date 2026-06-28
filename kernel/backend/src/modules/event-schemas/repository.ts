import { EntitySchemaSlug, EventSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import {
	DefinitionRegistry,
	type EventSchemaDefinition,
} from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

const toListed = (entitySchemaSlug: string, event: EventSchemaDefinition) => ({
	slug: event.slug,
	name: event.name,
	id: EventSchemaSlug.make(event.slug),
	propertiesSchema: event.propertiesSchema,
	...(event.pluginId == null ? {} : { pluginId: event.pluginId }),
	entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
});

export class EventSchemasRepository extends Context.Service<EventSchemasRepository>()(
	"EventSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const effectiveForUser = (userId: UserId) => pluginRuntime.getEffectiveDefinitions(userId);
			const getEntitySchemaScopeById = (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
			}) =>
				effectiveForUser(input.userId).pipe(
					Effect.map((effective) => {
						const definition = effective.entitySchemas[input.entitySchemaSlug];
						return definition
							? { userId: null, isBuiltin: true, slug: definition.slug, id: input.entitySchemaSlug }
							: null;
					}),
				);
			const getBuiltinBySlug = (input: { entitySchemaSlug: EntitySchemaSlug; slug: string }) => {
				const event = definitions.getEventSchema(input.entitySchemaSlug, input.slug);
				return Effect.succeed(
					event
						? { id: EventSchemaSlug.make(event.slug), propertiesSchema: event.propertiesSchema }
						: null,
				);
			};
			const listByEntitySchemaForUser = (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
			}) =>
				effectiveForUser(input.userId).pipe(
					Effect.map((effective) => {
						const entity = effective.entitySchemas[input.entitySchemaSlug];
						return entity
							? Object.values(entity.eventSchemas).map((event) =>
									toListed(input.entitySchemaSlug, event),
								)
							: [];
					}),
				);
			const getScopeForUser = (input: {
				userId: UserId;
				eventSchemaSlug: EventSchemaSlug;
				entitySchemaSlug: EntitySchemaSlug;
			}) => {
				return effectiveForUser(input.userId).pipe(
					Effect.map((effective) => {
						const event =
							effective.entitySchemas[input.entitySchemaSlug]?.eventSchemas[input.eventSchemaSlug];
						return event ? toListed(input.entitySchemaSlug, event) : null;
					}),
				);
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
