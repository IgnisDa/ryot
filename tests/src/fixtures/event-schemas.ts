import type { ContractPayload } from "@ryot/contract/client";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { installTestDefinitions } from "./test-plugin";

type PluginManifest = ContractPayload<"plugins", "install">["manifest"];
type PluginEntitySchema = PluginManifest["entitySchemas"][number];
type PluginEventSchema = PluginEntitySchema["eventSchemas"][number];

export type CreateEventSchemaOptions = Pick<PluginEventSchema, "name" | "slug"> & {
	entitySchemaSlug: PluginEntitySchema["slug"];
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
		const schemas = yield* client.call((c) => c.definitions.listEntities({}));
		const entitySchema = requirePresent(
			schemas.find((schema) => schema.slug === body.entitySchemaSlug),
			`Entity schema '${body.entitySchemaSlug}' not found`,
		);
		const eventSchema = {
			name: body.name,
			slug: body.slug,
			propertiesSchema: body.propertiesSchema ?? {
				fields: { note: { label: "Note", description: "Note", type: "string" as const } },
			},
		};
		const pluginSlug = requirePresent(
			entitySchema.pluginSlug,
			`Entity schema '${body.entitySchemaSlug}' is not owned by an installed plugin`,
		);
		yield* installTestDefinitions({
			pluginSlug,
			entitySchemas: [
				{
					icon: entitySchema.icon,
					name: entitySchema.name,
					slug: entitySchema.slug,
					accentColor: entitySchema.accentColor,
					propertiesSchema: entitySchema.propertiesSchema,
					eventSchemas: [
						...entitySchema.eventSchemas.filter((schema) => schema.slug !== body.slug),
						eventSchema,
					],
				},
			],
		});
		return {
			...eventSchema,
			id: EventSchemaSlug.make(body.slug),
			entitySchemaSlug: EntitySchemaSlug.make(body.entitySchemaSlug),
		};
	});

export const listEventSchemas = (client: Client, entitySchemaSlug: string) =>
	client
		.call((c) => c.definitions.listEntities({}))
		.pipe(
			Effect.map((schemas) =>
				requirePresent(
					schemas.find((schema) => schema.slug === entitySchemaSlug),
					`Entity schema '${entitySchemaSlug}' not found`,
				)
					.eventSchemas.map((schema) =>
						Object.assign({}, schema, {
							id: EventSchemaSlug.make(schema.slug),
							entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
						}),
					)
					.sort((left, right) => left.slug.localeCompare(right.slug)),
			),
		);
