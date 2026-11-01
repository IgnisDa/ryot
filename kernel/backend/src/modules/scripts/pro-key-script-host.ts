import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
} from "#modules/scripts/authorization/capabilities";
import { ProKeyService } from "#platform/pro-key";

export const makeProKeyScriptHost = Effect.gen(function* () {
	const proKey = yield* ProKeyService;

	return {
		getProAvailability: (rawInput) =>
			requireSandboxCapabilityInput(rawInput, "getProAvailability").pipe(
				Effect.andThen(proKey.isValidated),
				sandboxHostEffect,
			),
	} satisfies Pick<AdditionalScriptHostImplementationMap, "getProAvailability">;
});
