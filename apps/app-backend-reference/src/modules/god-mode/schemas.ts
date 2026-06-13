import { Schema } from "effect";

export class SystemStatus extends Schema.Class<SystemStatus>("SystemStatus")({
	status: Schema.Literal("ok"),
	timestamp: Schema.String,
}) {}
