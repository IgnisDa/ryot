import { expect, layer } from "@effect/vitest";
import {
	definitionKey,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { EntitySchemaSnapshot } from "#modules/definition-registry/snapshot";

import { EntitySchemasRepository } from "./repository";

const entitySchemaSlug = EntitySchemaSlug.make("shared-record");
const pluginId = PluginId.make("visible-plugin");
const kernelDefinition: EntitySchemaSnapshot = {
	icon: "record",
	pluginId: null,
	pluginSlug: null,
	eventSchemas: {},
	name: "Kernel record",
	slug: entitySchemaSlug,
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
};
const pluginDefinition: EntitySchemaSnapshot = {
	...kernelDefinition,
	pluginId,
	name: "Plugin record",
	pluginSlug: "visible-plugin",
};
const kernelReference: EntitySchemaReference = {
	slug: entitySchemaSlug,
	owner: { kind: "kernel" },
};
const pluginReference: EntitySchemaReference = {
	slug: entitySchemaSlug,
	owner: { pluginId, kind: "plugin" },
};

const repositoryLayer = EntitySchemasRepository.layer.pipe(
	Layer.provideMerge(
		Layer.mock(DefinitionRepository)({
			findGlobalEntitySchema: (reference) =>
				Effect.succeed(reference.owner.kind === "kernel" ? kernelDefinition : pluginDefinition),
			findUserEntitySchemas: (_userId, references) =>
				Effect.succeed(
					Object.fromEntries(
						references.flatMap((reference) => {
							if (reference.owner.kind !== "plugin" || reference.owner.pluginId !== pluginId) {
								return [];
							}
							return [[definitionKey("entity", reference.owner, reference.slug), pluginDefinition]];
						}),
					),
				),
		}),
	),
);

layer(repositoryLayer)((test) => {
	test.effect("lists only definitions visible to the user by qualified reference", () =>
		Effect.gen(function* () {
			const repository = yield* EntitySchemasRepository;
			expect(
				yield* repository.listVisibleByReferences(UserId.make("user"), [
					kernelReference,
					pluginReference,
				]),
			).toEqual([
				{
					pluginId,
					icon: "record",
					name: "Plugin record",
					slug: entitySchemaSlug,
					propertiesSchema: { fields: {} },
				},
			]);
		}),
	);

	test.effect("looks up global details with the requested owner and slug", () =>
		Effect.gen(function* () {
			const repository = yield* EntitySchemasRepository;
			expect(yield* repository.getGlobalByReference(pluginReference)).toEqual({
				pluginId,
				slug: entitySchemaSlug,
				propertiesSchema: { fields: {} },
			});
			expect(yield* repository.getGlobalDetailsByReference(kernelReference)).toMatchObject({
				pluginId: null,
				slug: entitySchemaSlug,
			});
		}),
	);
});
