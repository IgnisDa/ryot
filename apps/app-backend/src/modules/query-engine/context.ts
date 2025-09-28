import type { QueryEngineEventJoinLike, QueryEngineEventSchemaLike } from "~/lib/views/reference";

import type { QueryEngineSchemaRow } from "./query-cte-shared";
import type { QueryEngineContext } from "./schemas";

export type PreparedQueryContext = {
	relationshipSchemaIds: string[];
	eventSchemaSlugs: ReadonlySet<string>;
	eventJoins: QueryEngineEventJoinLike[];
	runtimeSchemas: QueryEngineSchemaRow[];
	schemaMap: Map<string, QueryEngineSchemaRow>;
	eventJoinMap: Map<string, QueryEngineEventJoinLike>;
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
	...overrides,
});
