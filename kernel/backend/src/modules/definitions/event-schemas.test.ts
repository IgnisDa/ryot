import { expect, layer } from "@effect/vitest";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { buildDefinitionSnapshot } from "#modules/definitions/snapshot";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";

import { EventSchemaReader } from "./event-schemas";

const privateOwner = PluginId.make("private-owner");
const shippedOwner = PluginId.make("shipped-owner");
const entitySchemaSlug = EntitySchemaSlug.make("shared-record");
const eventSchemaSlug = EventSchemaSlug.make("review");
const entityDefinition = (pluginSlug: string, pluginId: PluginId) => ({
	pluginId,
	icon: "record",
	slug: entitySchemaSlug,
	name: `${pluginSlug} record`,
	propertiesSchema: { fields: {} },
	eventSchemas: [
		{
			pluginId,
			slug: eventSchemaSlug,
			name: `${pluginSlug} review`,
			propertiesSchema: { fields: {} },
		},
	],
});
const snapshot = buildDefinitionSnapshot({
	savedViews: [],
	signalSchemas: [],
	relationshipSchemas: [],
	entitySchemas: [
		entityDefinition("private", privateOwner),
		entityDefinition("shipped", shippedOwner),
	],
});
const repositoryLayer = EventSchemaReader.layer.pipe(
	Layer.provideMerge(Layer.mock(DatabaseSession)({})),
	Layer.provideMerge(
		Layer.mock(DefinitionRepository)({
			listUserEventSchemas: (_userId, reference) => {
				const key = definitionKey("entity", reference.owner, reference.slug);
				return Effect.succeed(Object.values(snapshot.entitySchemas[key]?.eventSchemas ?? {}));
			},
			findUserEntitySchemas: (_userId, references) =>
				Effect.succeed(
					Object.fromEntries(
						references.flatMap((reference) => {
							const key = definitionKey("entity", reference.owner, reference.slug);
							const definition = snapshot.entitySchemas[key];
							return definition ? [[key, definition]] : [];
						}),
					),
				),
		}),
	),
	Layer.provideMerge(Layer.mock(PluginRuntimeResolver)({})),
);

layer(repositoryLayer)((test) => {
	test.effect("resolves same-slug event schemas by their entity schema owner", () =>
		Effect.gen(function* () {
			const repository = yield* EventSchemaReader;
			expect(
				yield* repository.getScopeForUser({
					eventSchemaSlug,
					entitySchemaSlug,
					userId: UserId.make("owner"),
					entitySchemaPluginId: shippedOwner,
				}),
			).toMatchObject({ id: eventSchemaSlug, pluginId: shippedOwner });
			expect(
				yield* repository.getScopeForUser({
					eventSchemaSlug,
					entitySchemaSlug,
					userId: UserId.make("owner"),
					entitySchemaPluginId: privateOwner,
				}),
			).toMatchObject({ id: eventSchemaSlug, pluginId: privateOwner });
			expect(
				yield* repository.getScopeForUser({
					eventSchemaSlug,
					entitySchemaSlug,
					entitySchemaPluginId: null,
					userId: UserId.make("owner"),
				}),
			).toBeNull();
		}),
	);

	test.effect("takes qualified entity references for user event listings and scopes", () =>
		Effect.gen(function* () {
			const repository = yield* EventSchemaReader;
			const userId = UserId.make("owner");
			const entitySchema = {
				slug: entitySchemaSlug,
				owner: { pluginId: privateOwner, kind: "plugin" as const },
			};
			expect(yield* repository.getEntitySchemaScopeById({ userId, entitySchema })).toMatchObject({
				slug: entitySchemaSlug,
				pluginId: privateOwner,
			});
			expect(yield* repository.listByEntitySchemaForUser({ userId, entitySchema })).toMatchObject([
				{ slug: eventSchemaSlug, pluginId: privateOwner },
			]);
		}),
	);
});
