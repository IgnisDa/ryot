import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { EventSchemaDefinition } from "#modules/definitions/snapshot";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";

type EventSchemaScopeInput = {
	readonly eventSchemaSlug: EventSchemaSlug;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: null | string;
};

const toListed = (entitySchemaSlug: string, event: EventSchemaDefinition) => ({
	slug: event.slug,
	name: event.name,
	pluginId: event.pluginId,
	id: EventSchemaSlug.make(event.slug),
	propertiesSchema: event.propertiesSchema,
	...(event.projection === undefined ? {} : { projection: event.projection }),
	entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
});

export class EventSchemaReader extends Context.Service<EventSchemaReader>()("EventSchemaReader", {
	make: Effect.gen(function* () {
		const definitions = yield* DefinitionRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const lockCatalog = pluginRuntime.lockCatalog;
		const getScopesForUser = (userId: UserId, inputs: ReadonlyArray<EventSchemaScopeInput>) => {
			const references = inputs.map((input) => ({
				slug: input.entitySchemaSlug,
				owner: definitionOwner(input.entitySchemaPluginId),
			}));
			return definitions.findUserEntitySchemas(userId, references).pipe(
				Effect.map((found) =>
					inputs.map((input) => {
						const entity =
							found[
								definitionKey(
									"entity",
									definitionOwner(input.entitySchemaPluginId),
									input.entitySchemaSlug,
								)
							];
						if (!entity || entity.pluginId !== input.entitySchemaPluginId) {
							return null;
						}
						const event = entity.eventSchemas[input.eventSchemaSlug];
						if (event && event.pluginId !== input.entitySchemaPluginId) {
							return null;
						}
						return event ? toListed(input.entitySchemaSlug, event) : null;
					}),
				),
			);
		};
		const getScopeForUser = (input: { userId: UserId } & EventSchemaScopeInput) =>
			getScopesForUser(input.userId, [input]).pipe(Effect.map(([scope]) => scope ?? null));

		return { lockCatalog, getScopeForUser, getScopesForUser };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
