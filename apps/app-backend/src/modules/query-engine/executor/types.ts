import type { AggregateOutput, QueryDocument, RowsOutput, TimeSeriesOutput } from "../language";

export type RootAliasKind = "entity" | "event" | "relationship";

// System fields backed by a timestamptz column, per root-alias kind. Used by the SQL compiler to
// decide the `date` kind and timestamptz casts.
export const SYSTEM_DATE_FIELDS_BY_KIND: Record<RootAliasKind, ReadonlySet<string>> = {
	entity: new Set(["createdAt", "updatedAt", "populatedAt"]),
	event: new Set(["createdAt", "updatedAt", "occurredAt"]),
	relationship: new Set(["createdAt"]),
};

export type RowsQueryDocument = QueryDocument & { output: RowsOutput };
export type AggregateQueryDocument = QueryDocument & { output: AggregateOutput };
export type TimeSeriesQueryDocument = QueryDocument & { output: TimeSeriesOutput };
