import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Ref } from "effect";

import { makeSubjectRunInput } from "#modules/scripts/authorization/principal.test-support";
import { ProKeyService } from "#platform/pro-key";

import { makeProKeyScriptHost } from "./pro-key-script-host";

it.effect("returns Pro availability from the existing key service", () =>
	Effect.gen(function* () {
		const calls = yield* Ref.make(0);
		const service = ProKeyService.of({
			isValidated: Ref.update(calls, (value) => value + 1).pipe(
				Effect.andThen(Effect.succeed(true)),
			),
		});
		const host = yield* makeProKeyScriptHost.pipe(Effect.provideService(ProKeyService, service));
		const userId = UserId.make("execution-owner");
		const input = makeSubjectRunInput({
			userId,
			type: "user",
			accountGeneration: { userId, token: "test-account-generation" },
		});

		expect(yield* host.getProAvailability(input)).toBe(true);
		expect(yield* Ref.get(calls)).toBe(1);
	}),
);

it.effect("returns false when the existing key service has no validated Pro key", () =>
	Effect.gen(function* () {
		const service = ProKeyService.of({ isValidated: Effect.succeed(false) });
		const host = yield* makeProKeyScriptHost.pipe(Effect.provideService(ProKeyService, service));
		const userId = UserId.make("execution-owner");
		const input = makeSubjectRunInput({
			userId,
			type: "user",
			accountGeneration: { userId, token: "test-account-generation" },
		});

		expect(yield* host.getProAvailability(input)).toBe(false);
	}),
);
