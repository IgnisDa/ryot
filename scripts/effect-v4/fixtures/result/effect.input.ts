import { Effect as FacadeEffect } from "@ryot/sandbox-sdk/effect";
import { Effect, pipe } from "effect";

const pending = Effect.either(Effect.succeed(1));

export const run = Effect.gen(function* () {
	const direct = yield* Effect.either(Effect.fail("direct"));
	const memberPipe = yield* Effect.succeed(1).pipe(Effect.either);
	const functionPipe = yield* pipe(Effect.fail("pipe"), Effect.either);
	const facade = yield* FacadeEffect.either(FacadeEffect.succeed(2));
	const sync = Effect.runSync(Effect.either(Effect.succeed(3)));

	return direct._tag === "Left"
		? direct.left
		: memberPipe.right + functionPipe.left + facade.right + sync.right;
});

void pending;
