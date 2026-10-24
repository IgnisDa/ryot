import { Context, Effect, Layer } from "effect";

import { CalendarDeliveryWorker } from "#modules/calendar-sources/delivery-worker";
import { CalendarDeliveryWorkerLive } from "#modules/calendar-sources/layer";
import { NotificationAdmissions } from "#modules/notifications/admission";
import { NotificationAdmissionsLive } from "#modules/notifications/layer";

export class CalendarDeliveryTestSupport extends Context.Service<CalendarDeliveryTestSupport>()(
	"CalendarDeliveryTestSupport",
	{
		make: Effect.gen(function* () {
			const deliveries = yield* CalendarDeliveryWorker;
			const notifications = yield* NotificationAdmissions;
			const scan = Effect.fn("CalendarDeliveryTestSupport.scan")(function* () {
				yield* deliveries.run();
				yield* notifications.recover();
			});
			return { scan };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(CalendarDeliveryWorkerLive, NotificationAdmissionsLive)),
	);
}
