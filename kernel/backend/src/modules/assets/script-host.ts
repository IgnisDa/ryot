import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import { userSandboxRunUserId } from "#modules/scripts/host/execution-context";

import { ManagedAssetsService } from "./storage/managed-assets";

export const makeAssetsScriptHost = Effect.gen(function* () {
	const managedAssets = yield* ManagedAssetsService;

	return {
		verifyManagedAssets: (rawInput, locators) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const input = yield* requireSandboxCapabilityInput(rawInput, "verifyManagedAssets");
					yield* managedAssets.verifyManagedAssetOwnership(userSandboxRunUserId(input), locators);
					return null;
				}),
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "verifyManagedAssets">;
});
