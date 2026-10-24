import { Context, Effect, Layer } from "effect";

import { NotificationAdmissions } from "#modules/notifications/admission";
import { NotificationAdmissionsLive } from "#modules/notifications/layer";
import { SignalScheduleWorkerLive } from "#modules/signal-schedules/layer";
import { SignalScheduleWorker } from "#modules/signal-schedules/worker";

export class SignalScheduleTestSupport extends Context.Service<SignalScheduleTestSupport>()(
	"SignalScheduleTestSupport",
	{
		make: Effect.gen(function* () {
			const schedules = yield* SignalScheduleWorker;
			const notifications = yield* NotificationAdmissions;
			const scan = Effect.fn("SignalScheduleTestSupport.scan")(function* () {
				yield* schedules.run();
				yield* notifications.recover();
			});
			return { scan };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(SignalScheduleWorkerLive, NotificationAdmissionsLive)),
	);
}
