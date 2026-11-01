import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { relationshipDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { collectRyotQLRecipeItems } from "./ryotql";
import { installTestDefinitions } from "./test-plugin";

type PluginRelationshipSchema = PluginManifest["relationshipSchemas"][number];

type CreateRelationshipSchemaOptions = { readonly pluginSlug: string } & Pick<
	PluginRelationshipSchema,
	"name" | "slug"
> &
	Partial<
		Pick<
			PluginRelationshipSchema,
			"propertiesSchema" | "sourceEntitySchemaSlug" | "targetEntitySchemaSlug"
		>
	>;

export function requireRelationshipSchemaBySlug<
	T extends { slug: string; pluginId: null | string },
>(schemas: readonly T[], slug: string, owner: DefinitionOwner): T {
	const pluginId = owner.kind === "kernel" ? null : owner.pluginId;
	const schema = schemas.find((s) => s.slug === slug && s.pluginId === pluginId);
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
		const installed = yield* installTestDefinitions({
			client,
			pluginSlug: body.pluginSlug,
			relationshipSchemas: [schema],
		});
		return {
			...schema,
			pluginId: installed.pluginId,
			id: RelationshipSchemaSlug.make(body.slug),
			reference: {
				owner: definitionOwner(installed.pluginId),
				slug: RelationshipSchemaSlug.make(body.slug),
			},
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
		owner?: DefinitionOwner;
		sourceEntitySchemaSlug?: null | string;
		targetEntitySchemaSlug?: null | string;
	} = {},
) =>
	collectRyotQLRecipeItems(client, (after) =>
		relationshipDefinitionsRecipe({ after, limit: 100 }),
	).pipe(
		Effect.map((schemas) =>
			schemas
				.filter(
					(schema) =>
						!options.owner ||
						schema.pluginId === (options.owner.kind === "kernel" ? null : options.owner.pluginId),
				)
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
						reference: { slug: schema.slug, owner: definitionOwner(schema.pluginId) },
					}),
				),
		),
	);
