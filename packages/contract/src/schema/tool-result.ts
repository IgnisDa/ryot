import { Schema } from "effect";

import { JsonValue } from "./json";

export const AgentToolResult = Schema.Union([
	Schema.Struct({ value: JsonValue, truncated: Schema.Literal(false) }),
	Schema.Struct({ jsonPrefix: Schema.String, truncated: Schema.Literal(true) }),
	Schema.Struct({
		lines: Schema.Int,
		bytes: Schema.Int,
		head: Schema.String,
		tail: Schema.String,
		outputId: Schema.String,
		producerLimited: Schema.Boolean,
		truncated: Schema.Literal("retained"),
	}),
]);
export type AgentToolResult = typeof AgentToolResult.Type;
