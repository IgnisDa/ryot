import { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema } from "../wire";
import { MANAGED_ASSET_VERIFY_SANDBOX_LIMITS } from "./limits";

export const verifyManagedAssetsArgsSchema = Schema.Tuple([
	Schema.Array(ManagedAssetLocator).pipe(
		Schema.check(Schema.isMaxLength(MANAGED_ASSET_VERIFY_SANDBOX_LIMITS.locators)),
	),
]);
export const verifyManagedAssetsResultSchema = hostResultSchema(Schema.Null);
