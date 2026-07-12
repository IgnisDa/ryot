import { Effect as Fx, Fiber as Fibers, Semaphore as EffectSemaphore } from "effect";
import { Effect as SandboxEffect } from "@ryot/sandbox-sdk/effect";

declare const Semaphore: { readonly occupied: true };
declare const effect: Fx.Effect<string, unknown>;
declare const fiber: Fibers.Fiber<void>;

type Lock = EffectSemaphore.Semaphore;

const program = Fx.gen(function* () {
	const lock = yield* EffectSemaphore.make(2);
	fiber.interruptUnsafe();
	yield* Fibers.await(fiber);
	return yield* SandboxEffect.die(new Error("sandbox facade"));
});
const timed = effect.pipe(Fx.timeoutOrElse({ duration: 5, orElse: () => Fx.fail("late") }));

void [Semaphore, program, timed];
void (0 as unknown as Lock);
