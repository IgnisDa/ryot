import type {
	QueryEngineEventJoinLike,
	QueryEngineReferenceContext,
	QueryEngineSchemaLike,
} from "~/lib/views/reference";

export type QueryEngineContext = QueryEngineReferenceContext<
	QueryEngineSchemaLike,
	QueryEngineEventJoinLike
>;
