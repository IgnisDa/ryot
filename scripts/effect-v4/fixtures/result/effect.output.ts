import { Effect as FacadeEffect } from "@ryot/sandbox-sdk/effect";
import { Effect, pipe } from "effect";

const pending = Effect.result(Effect.succeed(1));

export const run = Effect.gen(function* () {
	const direct = yield* Effect.result(Effect.fail("direct"));
	const memberPipe = yield* Effect.succeed(1).pipe(Effect.result);
	const functionPipe = yield* pipe(Effect.fail("pipe"), Effect.result);
	const facade = yield* FacadeEffect.result(FacadeEffect.succeed(2));
	const sync = Effect.runSync(Effect.result(Effect.succeed(3)));

	return direct._tag === "Failure"
		? direct.failure
		: memberPipe.success + functionPipe.failure + facade.success + sync.success;
});

void pending;
