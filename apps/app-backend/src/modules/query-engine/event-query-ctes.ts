import { sql } from "drizzle-orm";

import { schema } from "~/lib/db";

import {
	buildEntitySchemaDataExpression,
	buildEventSchemaDataExpression,
} from "./query-cte-shared";
import { sanitizeIdentifier } from "./sql-expression-helpers";

export const buildEventFirstCte = (input: {
	userId: string;
	cteName: string;
	entitySchemaIds: ReadonlyArray<string>;
	eventSchemaSlugs: ReadonlyArray<string>;
	dateRange?: { startAt: string; endAt: string };
}) => {
	sanitizeIdentifier(input.cteName, "CTE name");
	const entitySchemaIdList = sql.join(
		input.entitySchemaIds.map((id) => sql`${id}`),
		sql`, `,
	);
	const eventSchemaSlugList = sql.join(
		input.eventSchemaSlugs.map((slug) => sql`${slug}`),
		sql`, `,
	);

	const entitySchemaData = buildEntitySchemaDataExpression();
	const eventSchemaData = buildEventSchemaDataExpression();
	const dateRangeClause = input.dateRange
		? sql`and ${schema.event.occurredAt} >= ${input.dateRange.startAt}::timestamptz
			and ${schema.event.occurredAt} < ${input.dateRange.endAt}::timestamptz`
		: sql``;

	return sql`
		${sql.raw(input.cteName)} as (
			select
				${schema.event.id} as id,
				${schema.event.createdAt} as created_at,
				${schema.event.updatedAt} as updated_at,
				${schema.event.occurredAt} as occurred_at,
				${schema.event.properties} as properties,
				${schema.event.entityId} as entity_id,
				${schema.entity.name} as name,
				${schema.entity.image} as image,
				${schema.entity.createdAt} as entity_created_at,
				${schema.entity.updatedAt} as entity_updated_at,
				${schema.entity.properties} as entity_properties,
				${schema.entity.externalId} as external_id,
				${schema.entity.sandboxScriptId} as sandbox_script_id,
				${entitySchemaData} as entity_schema_data,
				${eventSchemaData} as event_schema_data
			from ${schema.event}
			inner join ${schema.entity} on ${schema.event.entityId} = ${schema.entity.id}
			inner join ${schema.entitySchema} on ${schema.entity.entitySchemaId} = ${schema.entitySchema.id}
			inner join ${schema.eventSchema} on ${schema.event.eventSchemaId} = ${schema.eventSchema.id}
			where ${schema.event.userId} = ${input.userId}
				and (${schema.entity.userId} = ${input.userId} or ${schema.entity.userId} is null)
				and ${schema.entity.entitySchemaId} in (${entitySchemaIdList})
				and ${schema.eventSchema.slug} in (${eventSchemaSlugList})
				${dateRangeClause}
		)
	`;
};
