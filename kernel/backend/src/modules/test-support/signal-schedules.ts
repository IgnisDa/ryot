import { Context, Effect, Layer } from "effect";

import { SignalScheduleWorkerLive } from "#modules/signal-schedules/layer";
import { SignalScheduleWorker } from "#modules/signal-schedules/worker";

export class SignalScheduleTestSupport extends Context.Service<SignalScheduleTestSupport>()(
	"@ryot-app/kernel-backend/modules/test-support/signal-schedules/SignalScheduleTestSupport",
	{
		make: Effect.gen(function* () {
			const schedules = yield* SignalScheduleWorker;
			const scan = Effect.fn("SignalScheduleTestSupport.scan")(function* () {
				yield* schedules.run();
			});
			return { scan };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(SignalScheduleWorkerLive),
	);
}
