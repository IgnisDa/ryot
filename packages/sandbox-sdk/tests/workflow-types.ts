import { Effect } from "@ryot/sandbox-sdk/workflow";

Effect.gen(function* () {
	yield* Effect.succeed(null);
});

// @ts-expect-error workflows cannot access the live Clock service.
void Effect.clockWith;
// @ts-expect-error workflows cannot access the live Random service.
void Effect.randomWith;
