import { Schema } from "effect";

import { JsonValue } from "./json";

export const AgentToolResult = Schema.Union([
	Schema.Struct({ value: JsonValue, truncated: Schema.Literal(false) }),
	Schema.Struct({ jsonPrefix: Schema.String, truncated: Schema.Literal(true) }),
]);
export type AgentToolResult = typeof AgentToolResult.Type;
