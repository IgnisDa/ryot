import { sql } from "drizzle-orm";

import { entity, entitySchema, event, eventSchema } from "~/lib/db/schema";

import {
	buildEntitySchemaDataExpression,
	buildEventSchemaDataExpression,
} from "./query-cte-shared";
import { sanitizeIdentifier } from "./sql-expression-helpers";

export const buildEventFirstCte = (input: {
	userId: string;
	cteName: string;
	entitySchemaIds: string[];
	eventSchemaSlugs: string[];
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
		? sql`and ${event.createdAt} >= ${input.dateRange.startAt}::timestamptz
			and ${event.createdAt} < ${input.dateRange.endAt}::timestamptz`
		: sql``;

	return sql`
		${sql.raw(input.cteName)} as (
			select
				${event.id} as id,
				${event.createdAt} as created_at,
				${event.updatedAt} as updated_at,
				${event.properties} as properties,
				${event.entityId} as entity_id,
				${entity.name} as name,
				${entity.image} as image,
				${entity.createdAt} as entity_created_at,
				${entity.updatedAt} as entity_updated_at,
				${entity.properties} as entity_properties,
				${entity.externalId} as external_id,
				${entity.sandboxScriptId} as sandbox_script_id,
				${entitySchemaData} as entity_schema_data,
				${eventSchemaData} as event_schema_data
			from ${event}
			inner join ${entity} on ${event.entityId} = ${entity.id}
			inner join ${entitySchema} on ${entity.entitySchemaId} = ${entitySchema.id}
			inner join ${eventSchema} on ${event.eventSchemaId} = ${eventSchema.id}
			where ${event.userId} = ${input.userId}
				and (${entity.userId} = ${input.userId} or ${entity.userId} is null)
				and ${entity.entitySchemaId} in (${entitySchemaIdList})
				and ${eventSchema.slug} in (${eventSchemaSlugList})
				${dateRangeClause}
		)
	`;
};
