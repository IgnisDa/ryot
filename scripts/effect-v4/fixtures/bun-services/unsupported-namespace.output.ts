import * as Platform from "@effect/platform-bun";

export const direct = Platform.BunContext.layer;
export const computed = Platform["BunContext"].layer;
export const optional = Platform?.BunContext.layer;
type Services = Platform.BunContext;
