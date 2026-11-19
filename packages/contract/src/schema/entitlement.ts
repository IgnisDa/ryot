import { Schema } from "effect";

import { strictStruct } from "./utils";

export const Entitlement = Schema.Literals(["pro"]);
export type Entitlement = typeof Entitlement.Type;

export const Entitlements = Schema.Array(Entitlement);
export type Entitlements = typeof Entitlements.Type;

export const isEntitled = (active: Entitlements, required: null | undefined | Entitlement) =>
	required === null || required === undefined || active.includes(required);

export const EntitlementRequiredReason = strictStruct({
	entitlement: Entitlement,
	code: Schema.Literal("entitlement-required"),
});
export type EntitlementRequiredReason = typeof EntitlementRequiredReason.Type;

export const entitlementRequiredReason = (entitlement: Entitlement): EntitlementRequiredReason => ({
	entitlement,
	code: "entitlement-required",
});

export class EntitlementRequired extends Schema.TaggedError<
	EntitlementRequired,
	{ readonly brand: unique symbol }
>()("EntitlementRequired", { reason: EntitlementRequiredReason }) {}

export const entitlementRequired = (entitlement: Entitlement) =>
	new EntitlementRequired({ reason: entitlementRequiredReason(entitlement) });
