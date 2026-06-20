import type { AggregateOutput, QueryDocument, RowsOutput, TimeSeriesOutput } from "../language";

export const MAX_ROOT_FILTER_SCAN_ROWS = 5000;
export const MAX_ROOT_SOURCE_SCAN_ROWS = 50000;
export const MAX_SERIALIZED_ROW_OBJECTS = 5000;
export const MAX_INCLUDE_FILTER_SCAN_ROWS = 5000;
export const MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS = 10000;

export type RootAliasKind = "entity" | "event" | "relationship";

// System fields backed by a timestamptz column, per root-alias kind. Shared by SQL time-column
// detection and by aggregate group-value reconstruction (these resolve to the `date` kind).
export const SYSTEM_DATE_FIELDS_BY_KIND: Record<RootAliasKind, ReadonlySet<string>> = {
	entity: new Set(["createdAt", "updatedAt", "populatedAt"]),
	event: new Set(["createdAt", "updatedAt", "occurredAt"]),
	relationship: new Set(["createdAt"]),
};

export type VisibleSchema = { id: string; slug: string };
export type VisibleEventSchema = { id: string; slug: string };
export type VisibleRelationshipSchema = { id: string; slug: string };

export type RowsQueryDocument = QueryDocument & { output: RowsOutput };
export type AggregateQueryDocument = QueryDocument & { output: AggregateOutput };
export type TimeSeriesQueryDocument = QueryDocument & { output: TimeSeriesOutput };

export type BaseEntityQueryRow = {
	id: string;
	name: string;
	schemaId: string;
	schemaSlug: string;
	schemaName: string;
	userId: string | null;
	schemaIsBuiltin: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
	externalId: string | null;
	totalCount: string | bigint;
	sandboxScriptId: string | null;
	populatedAt: Date | string | null;
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
	eventUserId: string;
	eventSchemaId: string;
	eventEntityId: string;
	eventSchemaSlug: string;
	eventSchemaName: string;
	eventSchemaIsBuiltin: boolean;
	eventCreatedAt: Date | string;
	eventUpdatedAt: Date | string;
	eventOccurredAt: Date | string;
	eventSessionEntityId: string | null;
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
