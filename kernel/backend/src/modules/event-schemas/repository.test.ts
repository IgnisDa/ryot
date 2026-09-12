import { expect, it } from "@effect/vitest";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { buildDefinitionSnapshot } from "#modules/definition-registry/snapshot";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EventSchemasRepository } from "./repository";

it.effect(
	"does not substitute a same-slug event definition from another entity schema owner",
	() => {
		const privateOwner = PluginId.make("private-owner");
		const shippedOwner = PluginId.make("shipped-owner");
		const entitySchemaSlug = EntitySchemaSlug.make("shared-record");
		const eventSchemaSlug = EventSchemaSlug.make("review");
		const snapshot = buildDefinitionSnapshot({
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
			Layer.provideMerge(
				Layer.mock(DefinitionRepository)({
					findUserEntitySchemas: () => Effect.succeed(snapshot.entitySchemas),
				}),
			),
			Layer.provideMerge(Layer.mock(PluginRuntimeResolver)({})),
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
