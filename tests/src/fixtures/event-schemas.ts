import { EntitySchemaSlug, EventSchemaSlug } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { installTestDefinitions } from "./test-plugin";

export interface CreateEventSchemaOptions {
	name: string;
	slug: string;
	entitySchemaSlug: string;
	propertiesSchema?: AppSchema;
}

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
						Object.assign({}, schema, { id: schema.slug, entitySchemaSlug }),
					)
					.sort((left, right) => left.slug.localeCompare(right.slug)),
			),
		);
