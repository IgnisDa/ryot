import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { relationshipDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems } from "./ryotql";
import { installTestDefinitions } from "./test-plugin";

type PluginRelationshipSchema = PluginManifest["relationshipSchemas"][number];

type CreateRelationshipSchemaOptions = Pick<PluginRelationshipSchema, "name" | "slug"> &
	Partial<
		Pick<
			PluginRelationshipSchema,
			"propertiesSchema" | "sourceEntitySchemaSlug" | "targetEntitySchemaSlug"
		>
	>;

export function requireRelationshipSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Relationship schema '${slug}' not found`);
}

export const createRelationshipSchema = (client: Client, body: CreateRelationshipSchemaOptions) =>
	Effect.gen(function* () {
		const schema = {
			name: body.name,
			slug: body.slug,
			propertiesSchema: body.propertiesSchema ?? { fields: {} },
			sourceEntitySchemaSlug: body.sourceEntitySchemaSlug ?? null,
			targetEntitySchemaSlug: body.targetEntitySchemaSlug ?? null,
		};
		yield* installTestDefinitions({
			client,
			relationshipSchemas: [schema],
			pluginSlug: `e2e-relationship-${crypto.randomUUID()}`,
		});
		return {
			...schema,
			id: RelationshipSchemaSlug.make(body.slug),
			sourceEntitySchemaSlug:
				body.sourceEntitySchemaSlug == null
					? null
					: EntitySchemaSlug.make(body.sourceEntitySchemaSlug),
			targetEntitySchemaSlug:
				body.targetEntitySchemaSlug == null
					? null
					: EntitySchemaSlug.make(body.targetEntitySchemaSlug),
		};
	});

export const listRelationshipSchemas = (
	client: Client,
	options: {
		slugs?: string[];
		sourceEntitySchemaSlug?: string | null;
		targetEntitySchemaSlug?: string | null;
	} = {},
) =>
	collectRyotQLRecipeItems(client, (after) =>
		relationshipDefinitionsRecipe({ after, limit: 100 }),
	).pipe(
		Effect.map((schemas) =>
			schemas
				.filter((schema) => !options.slugs || options.slugs.includes(schema.slug))
				.filter(
					(schema) =>
						options.sourceEntitySchemaSlug === undefined ||
						schema.sourceEntitySchemaSlug === options.sourceEntitySchemaSlug,
				)
				.filter(
					(schema) =>
						options.targetEntitySchemaSlug === undefined ||
						schema.targetEntitySchemaSlug === options.targetEntitySchemaSlug,
				)
				.map((schema) =>
					Object.assign({}, schema, {
						isBuiltin: true,
						id: RelationshipSchemaSlug.make(schema.slug),
					}),
				),
		),
	);
