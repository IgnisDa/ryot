import type { QueryFilter } from "#lib/query-language";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
	QueryEngineReferenceContext,
	QueryEngineRelationshipJoinLike,
} from "#lib/views/reference";

import type { QueryEngineSchemaRow } from "./query-cte-shared";

export type LoadedRelationshipJoin = QueryEngineRelationshipJoinLike & {
	schemaId: string;
	required: boolean;
	sourceEntityId?: string;
	targetEntityId?: string;
	filter: QueryFilter | null;
	direction: "outgoing" | "incoming";
};

export type PreparedQueryContext = {
	eventSchemaSlugs: ReadonlySet<string>;
	eventJoins: QueryEngineEventJoinLike[];
	runtimeSchemas: QueryEngineSchemaRow[];
	relationshipJoins: LoadedRelationshipJoin[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
	relationshipJoinMap: Map<string, LoadedRelationshipJoin>;
	eventSchemaMap?: Map<string, QueryEngineEventSchemaLike[]>;
};

export type QueryEngineContext = QueryEngineReferenceContext;

export const buildQueryContext = (
	userId: string,
	context: PreparedQueryContext,
	overrides?: Partial<QueryEngineContext>,
): QueryEngineContext => ({
	userId,
	schemaMap: context.schemaMap,
	eventJoinMap: context.eventJoinMap,
	relationshipJoinMap: context.relationshipJoinMap,
	...overrides,
});
