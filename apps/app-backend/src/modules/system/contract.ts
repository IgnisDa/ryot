import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

const HealthResponse = Schema.Struct({ status: Schema.Literal("healthy") });

export const SystemGroup = HttpApiGroup.make("system").add(
	HttpApiEndpoint.get("health", "/system/health").addSuccess(HealthResponse, { status: 200 }),
);
