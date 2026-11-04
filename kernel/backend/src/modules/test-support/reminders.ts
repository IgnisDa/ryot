import { Context, Effect, Layer } from "effect";

import { ReminderWorkerLive } from "#modules/reminders/layer";
import { ReminderWorker } from "#modules/reminders/worker";

export class ReminderTestSupport extends Context.Service<ReminderTestSupport>()(
	"@ryot-app/kernel-backend/modules/test-support/reminders/ReminderTestSupport",
	{
		make: Effect.gen(function* () {
			const reminders = yield* ReminderWorker;
			const scan = Effect.fn("ReminderTestSupport.scan")(function* () {
				yield* reminders.run();
			});
			return { scan };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(ReminderWorkerLive));
}
