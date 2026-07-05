import { EntitySchemaSlug, RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";

export interface CreateRelationshipSchemaOptions {
	name: string;
	slug: string;
	sourceEntitySchemaSlug?: string | null;
	targetEntitySchemaSlug?: string | null;
	propertiesSchema?: AppSchema;
}

export function requireRelationshipSchemaBySlug<T extends { slug: string }>(
	schemas: readonly T[],
	slug: string,
): T {
	const schema = schemas.find((s) => s.slug === slug);
	return requirePresent(schema, `Relationship schema '${slug}' not found`);
}

export const createRelationshipSchema = (_client: Client, body: CreateRelationshipSchemaOptions) =>
	Effect.gen(function* () {
		const schema = {
			name: body.name,
			slug: body.slug,
			propertiesSchema: body.propertiesSchema ?? { fields: {} },
			sourceEntitySchemaSlug: body.sourceEntitySchemaSlug ?? null,
			targetEntitySchemaSlug: body.targetEntitySchemaSlug ?? null,
		};
		yield* getBackendClient().call(
			(c) => c.testSupport.installDefinitions({ payload: { relationshipSchemas: [schema] } }),
			adminHeaders,
		);
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
	client
		.call((c) => c.definitions.listRelationships({}))
		.pipe(
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
					.map((schema) => Object.assign({}, schema, { id: schema.slug, isBuiltin: true })),
			),
		);
