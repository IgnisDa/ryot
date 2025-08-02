import { sql } from "drizzle-orm";
import { entitySchema, eventSchema } from "~/lib/db/schema";
import type {
	EntityColumnOverrides,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";
import type { SqlExpression } from "./sql-expression-helpers";

export type QueryEngineSchemaRow = QueryEngineSchemaLike & {
	id: string;
};

export type PaginationConfig = {
	limit: number;
	offset: number;
	countAlias: string;
	rowIdColumn: string;
	sortedAlias: string;
	filteredAlias: string;
	paginatedAlias: string;
	joinedTableName: string;
};

export const EVENT_FIRST_ENTITY_COLUMN_OVERRIDES: EntityColumnOverrides = {
	id: "entity_id",
	properties: "entity_properties",
	created_at: "entity_created_at",
	updated_at: "entity_updated_at",
};

export const buildEntitySchemaDataExpression = () =>
	sql`jsonb_build_object(
		'id', ${entitySchema.id},
		'slug', ${entitySchema.slug},
		'name', ${entitySchema.name},
		'icon', ${entitySchema.icon},
		'userId', ${entitySchema.userId},
		'isBuiltin', ${entitySchema.isBuiltin},
		'createdAt', ${entitySchema.createdAt},
		'updatedAt', ${entitySchema.updatedAt},
		'accentColor', ${entitySchema.accentColor}
	)`;

export const buildEventSchemaDataExpression = () =>
	sql`jsonb_build_object(
		'id', ${eventSchema.id},
		'slug', ${eventSchema.slug},
		'name', ${eventSchema.name},
		'isBuiltin', ${eventSchema.isBuiltin},
		'createdAt', ${eventSchema.createdAt},
		'updatedAt', ${eventSchema.updatedAt}
	)`;

export const getEventJoinCteName = (joinKey: string) =>
	`latest_event_join_${joinKey}`;

export type PaginatedQueryInput = PaginationConfig & {
	direction: SqlExpression;
	withCtes: SqlExpression[];
	filterClause: SqlExpression;
	sortExpression: SqlExpression;
	resolvedFields: SqlExpression;
};
