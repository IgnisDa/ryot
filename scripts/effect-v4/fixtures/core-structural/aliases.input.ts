import { Effect as Fx, Fiber as Fibers } from "effect";
import { Effect as SandboxEffect } from "@ryot/sandbox-sdk/effect";

declare const Semaphore: { readonly occupied: true };
declare const effect: Fx.Effect<string, unknown>;
declare const fiber: Fibers.Fiber<void>;

type Lock = Fx.Semaphore;

const program = Fx.gen(function* () {
	const lock = yield* Fx.makeSemaphore(2);
	yield* Fibers.interruptFork(fiber);
	yield* Fibers.await(fiber);
	return yield* SandboxEffect.dieMessage("sandbox facade");
});
const timed = effect.pipe(Fx.timeoutFail({ duration: 5, onTimeout: () => "late" }));

void [Semaphore, program, timed];
void (0 as unknown as Lock);
