import type { ViewPredicate } from "~/lib/views/expression";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
	QueryEngineRelationshipJoinLike,
} from "~/lib/views/reference";

import type { QueryEngineSchemaRow } from "./query-cte-shared";
import type { QueryEngineContext } from "./schemas";

export type LoadedRelationshipJoin = QueryEngineRelationshipJoinLike & {
	schemaId: string;
	required: boolean;
	sourceEntityId?: string;
	targetEntityId?: string;
	filter: ViewPredicate | null;
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
