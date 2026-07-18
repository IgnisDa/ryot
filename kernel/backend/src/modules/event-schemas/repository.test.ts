import { expect, it } from "@effect/vitest";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EventSchemasRepository } from "./repository";

it.effect(
	"does not substitute a same-slug event definition from another entity schema owner",
	() => {
		const privateOwner = PluginId.make("private-owner");
		const shippedOwner = PluginId.make("shipped-owner");
		const entitySchemaSlug = EntitySchemaSlug.make("shared-record");
		const eventSchemaSlug = EventSchemaSlug.make("review");
		const registry = makeDefinitionRegistry({
			savedViews: [],
			signalSchemas: [],
			relationshipSchemas: [],
			entitySchemas: [
				{
					icon: "record",
					pluginSlug: "private",
					name: "Private record",
					pluginId: privateOwner,
					slug: entitySchemaSlug,
					propertiesSchema: { fields: {} },
					eventSchemas: [
						{
							name: "Review",
							slug: eventSchemaSlug,
							pluginId: privateOwner,
							propertiesSchema: { fields: {} },
						},
					],
				},
			],
		});
		const layer = EventSchemasRepository.layer.pipe(
			Layer.provideMerge(Layer.succeed(Database, Database.of(Object.create(null)))),
			Layer.provideMerge(Layer.succeed(DefinitionRegistry, registry)),
			Layer.provideMerge(
				Layer.mock(PluginRuntimeResolver)({
					getEffectiveDefinitions: () => Effect.succeed(registry.getSnapshot()),
				}),
			),
		);

		return Effect.gen(function* () {
			const repository = yield* EventSchemasRepository;
			expect(
				yield* repository.getScopeForUser({
					eventSchemaSlug,
					entitySchemaSlug,
					userId: UserId.make("owner"),
					entitySchemaPluginId: shippedOwner,
				}),
			).toBeNull();
			expect(
				yield* repository.getScopeForUser({
					eventSchemaSlug,
					entitySchemaSlug,
					userId: UserId.make("owner"),
					entitySchemaPluginId: privateOwner,
				}),
			).toMatchObject({ id: eventSchemaSlug, pluginId: privateOwner });
		}).pipe(Effect.provide(layer));
	},
);
