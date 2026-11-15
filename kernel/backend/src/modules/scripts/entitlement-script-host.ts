import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import { EntitlementService } from "#platform/entitlements";

export const makeEntitlementScriptHost = Effect.gen(function* () {
	const entitlements = yield* EntitlementService;

	return {
		getEntitlements: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getEntitlements").pipe(
				Effect.andThen(entitlements.current),
				sandboxHostEffect,
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "getEntitlements">;
});
