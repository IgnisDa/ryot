import {
	definitionKey,
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { EventSchemaDefinition } from "#modules/definitions/snapshot";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";

type EventSchemaScopeInput = {
	readonly eventSchemaSlug: EventSchemaSlug;
	readonly entitySchemaPluginId: string | null;
	readonly entitySchemaSlug: EntitySchemaSlug;
};

const toListed = (entitySchemaSlug: string, event: EventSchemaDefinition) => ({
	slug: event.slug,
	name: event.name,
	pluginId: event.pluginId,
	id: EventSchemaSlug.make(event.slug),
	propertiesSchema: event.propertiesSchema,
	entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
});

export class EventSchemaReader extends Context.Service<EventSchemaReader>()("EventSchemaReader", {
	make: Effect.gen(function* () {
		const definitions = yield* DefinitionRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const lockCatalog = pluginRuntime.lockCatalog;
		const findEntitySchema = (userId: UserId, reference: EntitySchemaReference) =>
			definitions
				.findUserEntitySchemas(userId, [reference])
				.pipe(
					Effect.map(
						(found) => found[definitionKey("entity", reference.owner, reference.slug)] ?? null,
					),
				);
		const getEntitySchemaScopeById = (input: {
			userId: UserId;
			entitySchema: EntitySchemaReference;
		}) =>
			findEntitySchema(input.userId, input.entitySchema).pipe(
				Effect.map((definition) => {
					return definition
						? {
								userId: null,
								slug: definition.slug,
								id: input.entitySchema.slug,
								pluginId: definition.pluginId,
								isBuiltin: definition.pluginId === null,
							}
						: null;
				}),
			);
		const getBuiltinBySlug = (input: { entitySchemaSlug: EntitySchemaSlug; slug: string }) =>
			definitions
				.findGlobalEventSchema({
					owner: { kind: "kernel" },
					slug: EventSchemaSlug.make(input.slug),
					entitySchemaSlug: input.entitySchemaSlug,
				})
				.pipe(
					Effect.map((event) =>
						event
							? {
									slug: event.slug,
									pluginId: event.pluginId,
									id: EventSchemaSlug.make(event.slug),
									propertiesSchema: event.propertiesSchema,
								}
							: null,
					),
				);
		const listByEntitySchemaForUser = (input: {
			userId: UserId;
			entitySchema: EntitySchemaReference;
		}) =>
			definitions
				.listUserEventSchemas(input.userId, input.entitySchema)
				.pipe(
					Effect.map((events) => events.map((event) => toListed(input.entitySchema.slug, event))),
				);
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
		const getScopeForUser = (input: EventSchemaScopeInput & { userId: UserId }) =>
			getScopesForUser(input.userId, [input]).pipe(Effect.map(([scope]) => scope ?? null));

		return {
			lockCatalog,
			getScopeForUser,
			getScopesForUser,
			getBuiltinBySlug,
			getEntitySchemaScopeById,
			listByEntitySchemaForUser,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
