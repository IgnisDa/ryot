import { Cause, Effect } from "effect";

export const catchNonInterrupt =
	<A2, E2, R2>(handler: (cause: Cause.Cause<unknown>) => Effect.Effect<A2, E2, R2>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.catchCauseIf(effect, (cause) => !Cause.hasInterrupts(cause), handler);
