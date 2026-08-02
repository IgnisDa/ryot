import { EntitySchemaSlug, EventSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { EventSchemaDefinition } from "#modules/definition-registry/snapshot";
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
			const definitions = yield* DefinitionRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const lockCatalog = pluginRuntime.lockCatalog;
			const findEntitySchema = (userId: UserId, slug: EntitySchemaSlug) =>
				definitions
					.findUserEntitySchemas(userId, [slug])
					.pipe(Effect.map((found) => found[slug] ?? null));
			const getEntitySchemaScopeById = (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
			}) =>
				findEntitySchema(input.userId, input.entitySchemaSlug).pipe(
					Effect.map((definition) => {
						return definition
							? { userId: null, isBuiltin: true, slug: definition.slug, id: input.entitySchemaSlug }
							: null;
					}),
				);
			const getBuiltinBySlug = (input: { entitySchemaSlug: EntitySchemaSlug; slug: string }) =>
				definitions
					.findGlobalEventSchema(input.entitySchemaSlug, input.slug)
					.pipe(
						Effect.map((event) =>
							event
								? { id: EventSchemaSlug.make(event.slug), propertiesSchema: event.propertiesSchema }
								: null,
						),
					);
			const listByEntitySchemaForUser = (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
			}) =>
				definitions
					.listUserEventSchemas(input.userId, input.entitySchemaSlug)
					.pipe(
						Effect.map((events) => events.map((event) => toListed(input.entitySchemaSlug, event))),
					);
			const getScopeForUser = (input: {
				userId: UserId;
				eventSchemaSlug: EventSchemaSlug;
				entitySchemaPluginId: string | null;
				entitySchemaSlug: EntitySchemaSlug;
			}) => {
				return findEntitySchema(input.userId, input.entitySchemaSlug).pipe(
					Effect.map((entity) => {
						if (!entity || (entity.pluginId ?? null) !== input.entitySchemaPluginId) {
							return null;
						}
						const event = entity.eventSchemas[input.eventSchemaSlug];
						if (event && (event.pluginId ?? null) !== input.entitySchemaPluginId) {
							return null;
						}
						return event ? toListed(input.entitySchemaSlug, event) : null;
					}),
				);
			};

			return {
				lockCatalog,
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
