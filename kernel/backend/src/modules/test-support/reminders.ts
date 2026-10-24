import { Context, Effect, Layer } from "effect";

import { NotificationAdmissions } from "#modules/notifications/admission";
import { NotificationAdmissionsLive } from "#modules/notifications/layer";
import { ReminderWorkerLive } from "#modules/reminders/layer";
import { ReminderWorker } from "#modules/reminders/worker";

export class ReminderTestSupport extends Context.Service<ReminderTestSupport>()(
	"ReminderTestSupport",
	{
		make: Effect.gen(function* () {
			const reminders = yield* ReminderWorker;
			const notifications = yield* NotificationAdmissions;
			const scan = Effect.fn("ReminderTestSupport.scan")(function* () {
				yield* notifications.recover();
				yield* reminders.run();
			});
			return { scan };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(ReminderWorkerLive, NotificationAdmissionsLive)),
	);
}
