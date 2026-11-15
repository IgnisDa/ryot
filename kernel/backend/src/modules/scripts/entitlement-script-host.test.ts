import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { makeSubjectRunInput } from "#modules/scripts/authorization/principal.test-support";
import { provideEntitlements } from "#platform/entitlements.test-support";

import { makeEntitlementScriptHost } from "./entitlement-script-host";

it.effect.each([{ entitlements: ["pro"] as const }, { entitlements: [] }])(
	"returns the instance entitlements $entitlements to an authorized subject",
	({ entitlements }) =>
		Effect.gen(function* () {
			const host = yield* makeEntitlementScriptHost.pipe(provideEntitlements(entitlements));
			const input = makeSubjectRunInput({ type: "user", userId: UserId.make("execution-owner") });

			expect(yield* host.getEntitlements(input)).toEqual(entitlements);
		}),
	testTimeout,
);
