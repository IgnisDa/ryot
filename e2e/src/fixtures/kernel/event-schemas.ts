import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type {
	EntitySchemaReference,
	EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems } from "./ryotql";
import { findTestEntitySchema, installTestDefinitions } from "./test-plugin";

type PluginEntitySchema = PluginManifest["entitySchemas"][number];
type PluginEventSchema = PluginEntitySchema["eventSchemas"][number];

type CreateEventSchemaOptions = Pick<PluginEventSchema, "name" | "slug"> & {
	entitySchema: EntitySchemaReference;
	propertiesSchema?: PluginEventSchema["propertiesSchema"];
};

export function requireEventSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Event schema '${slug}' not found`);
}

export const createEventSchema = (client: Client, body: CreateEventSchemaOptions) =>
	Effect.gen(function* () {
		const registered = requirePresent(
			findTestEntitySchema(client, body.entitySchema),
			`Entity schema '${body.entitySchema.slug}' not found`,
		);
		const eventSchema = {
			name: body.name,
			slug: body.slug,
			propertiesSchema: body.propertiesSchema ?? {
				fields: { note: { label: "Note", description: "Note", type: "string" as const } },
			},
		};
		yield* installTestDefinitions({
			client,
			pluginSlug: registered.pluginSlug,
			entitySchemas: [
				{
					...registered.schema,
					eventSchemas: [
						...registered.schema.eventSchemas.filter((schema) => schema.slug !== body.slug),
						eventSchema,
					],
				},
			],
		});
		return {
			...eventSchema,
			id: EventSchemaSlug.make(body.slug),
			entitySchemaSlug: body.entitySchema.slug,
			reference: {
				owner: body.entitySchema.owner,
				slug: EventSchemaSlug.make(body.slug),
				entitySchemaSlug: body.entitySchema.slug,
			} satisfies EventSchemaReference,
		};
	});

export const listEventSchemas = (client: Client, reference: EntitySchemaReference) =>
	collectRyotQLRecipeItems(client, (after) => entityDefinitionsRecipe({ after, limit: 100 })).pipe(
		Effect.map((schemas) =>
			requirePresent(
				schemas.find(
					(schema) =>
						schema.slug === reference.slug &&
						schema.pluginId ===
							(reference.owner.kind === "kernel" ? null : reference.owner.pluginId),
				),
				`Entity schema '${reference.slug}' not found`,
			)
				.eventSchemas.items.map((schema) =>
					Object.assign({}, schema, {
						entitySchemaSlug: reference.slug,
						id: EventSchemaSlug.make(schema.slug),
						reference: {
							owner: reference.owner,
							entitySchemaSlug: reference.slug,
							slug: EventSchemaSlug.make(schema.slug),
						} satisfies EventSchemaReference,
					}),
				)
				.sort((left, right) => left.slug.localeCompare(right.slug)),
		),
	);
