import {
	Entitlement,
	entitlementRequiredReason,
	Entitlements,
} from "@ryot-app/contract/schema/entitlement";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema } from "../wire";

export const getEntitlementsArgsSchema = Schema.Tuple([]);
export const getEntitlementsResultSchema = hostResultSchema(Entitlements);

export class EntitlementRequiredError extends Schema.TaggedError<
	EntitlementRequiredError,
	{ readonly brand: unique symbol }
>()("EntitlementRequiredError", { entitlement: Entitlement }) {
	get data() {
		return entitlementRequiredReason(this.entitlement);
	}
}
