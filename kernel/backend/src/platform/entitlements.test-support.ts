import type { Entitlements } from "@ryot-app/contract/schema/entitlement";
import { Effect, Layer } from "effect";

import { EntitlementService, entitlementServiceFrom } from "./entitlements";

export const provideEntitlements = (current: Entitlements) =>
	Effect.provideService(
		EntitlementService,
		EntitlementService.of(entitlementServiceFrom(Effect.succeed(current))),
	);

export const entitlementsLayer = (current: Entitlements | Effect.Effect<Entitlements>) =>
	Layer.succeed(
		EntitlementService,
		EntitlementService.of(
			entitlementServiceFrom(Effect.isEffect(current) ? current : Effect.succeed(current)),
		),
	);
