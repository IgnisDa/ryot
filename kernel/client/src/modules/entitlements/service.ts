import type { Entitlements } from "@ryot-app/contract/schema/entitlement";
import { Effect } from "effect";

import type { ServerOrigin } from "#/api/origin";
import { PublicApi } from "#/api/public";

export const loadEntitlements = (origin: ServerOrigin) =>
	Effect.flatMap(PublicApi, (api) => api.getSystemConfig(origin)).pipe(
		Effect.map((config): Entitlements => config.entitlements),
		Effect.orElseSucceed((): Entitlements => []),
	);
