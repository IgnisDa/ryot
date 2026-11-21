import { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema } from "../wire";
import { MANAGED_ASSET_VERIFY_SANDBOX_LIMITS } from "./limits";
import type { ScriptHost } from "./script-host";

export const verifyManagedAssetsArgsSchema = Schema.Tuple([
	Schema.Array(ManagedAssetLocator).pipe(
		Schema.check(Schema.isMaxLength(MANAGED_ASSET_VERIFY_SANDBOX_LIMITS.locators)),
	),
]);
export const verifyManagedAssetsResultSchema = hostResultSchema(Schema.Null);

/** A managed asset the run's user may not reference. */
export class ManagedAssetForbiddenError extends Schema.TaggedError<
	ManagedAssetForbiddenError,
	{ readonly brand: unique symbol }
>()("ManagedAssetForbiddenError", {}) {}

const isAssetForbidden = Schema.is(
	Schema.Struct({ data: Schema.Struct({ code: Schema.Literal("asset-forbidden") }) }),
);

/** Verifies the run's user may reference `locators`, failing typed when one is forbidden. */
export const verifyManagedAssets = (
	verify: ScriptHost["verifyManagedAssets"],
	locators: (typeof verifyManagedAssetsArgsSchema.Type)[0],
) =>
	verify(locators).pipe(
		Effect.catchIf(isAssetForbidden, () => Effect.fail(new ManagedAssetForbiddenError())),
	);
