import type { AggregateOutput, QueryDocument, RowsOutput, TimeSeriesOutput } from "../language";

export const MAX_ROOT_FILTER_SCAN_ROWS = 5000;
export const MAX_SERIALIZED_ROW_OBJECTS = 5000;
export const MAX_INCLUDE_FILTER_SCAN_ROWS = 5000;
export const MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS = 10000;

export type VisibleSchema = { id: string; slug: string };
export type VisibleEventSchema = { id: string; slug: string };
export type VisibleRelationshipSchema = { id: string; slug: string };

export type RowsQueryDocument = QueryDocument & { output: RowsOutput };
export type AggregateQueryDocument = QueryDocument & { output: AggregateOutput };
export type TimeSeriesQueryDocument = QueryDocument & { output: TimeSeriesOutput };

export type BaseEntityQueryRow = {
	id: string;
	name: string;
	image: unknown;
	schemaId: string;
	schemaSlug: string;
	schemaName: string;
	schemaIsBuiltin: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
	externalId: string | null;
	totalCount: string | bigint;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
};

export type EntityQueryRow = BaseEntityQueryRow & { totalCount: string | bigint };

export type RelationshipFields = {
	relationshipId: string | null;
	relationshipSchemaSlug: string | null;
	relationshipSchemaName: string | null;
	relationshipSourceEntityId: string | null;
	relationshipTargetEntityId: string | null;
	relationshipSchemaIsBuiltin: boolean | null;
	relationshipCreatedAt: Date | string | null;
	relationshipProperties: Record<string, unknown> | null;
};

export type IncludeQueryRow = BaseEntityQueryRow & RelationshipFields;

export type EventFields = {
	eventId: string;
	eventSchemaId: string;
	eventSchemaSlug: string;
	eventSchemaName: string;
	eventSchemaIsBuiltin: boolean;
	eventCreatedAt: Date | string;
	eventUpdatedAt: Date | string;
	eventOccurredAt: Date | string;
	eventProperties: Record<string, unknown>;
};

export type RelationshipEntityFields = Omit<BaseEntityQueryRow, "totalCount">;
export type EventQueryRow = BaseEntityQueryRow & EventFields & { totalCount: string | bigint };

export type RelationshipRootQueryRow = RelationshipFields & {
	totalCount: string | bigint;
	sourceEntity: RelationshipEntityFields;
	targetEntity: RelationshipEntityFields;
};

export type RowContext = {
	events: Map<string, EventFields>;
	entities: Map<string, BaseEntityQueryRow>;
	relationships: Map<string, RelationshipFields>;
};

export type SourceMatch = { context: RowContext; row: BaseEntityQueryRow };
