import { Layer } from "effect";

import { NotificationAdmissions } from "./admission";
import { NotificationDeliveryService, NotificationMailer } from "./delivery";
import { NotificationDeliveryJobLive } from "./delivery-job";
import { NotificationDeliveryRepository } from "./delivery-repository";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

export const NotificationAdmissionsLive = NotificationAdmissions.layer.pipe(
	Layer.provide(
		Layer.mergeAll(NotificationsRepository.layer, NotificationDeliveryRepository.layer),
	),
);

export const NotificationsServiceLive = NotificationsService.layer.pipe(
	Layer.provide(Layer.mergeAll(NotificationsRepository.layer, NotificationAdmissionsLive)),
);

export const NotificationDeliveryServiceLive = NotificationDeliveryService.layer.pipe(
	Layer.provide(NotificationMailer.layer),
);

export const NotificationDeliveryJobProvidedLive = NotificationDeliveryJobLive.pipe(
	Layer.provide(
		Layer.mergeAll(NotificationDeliveryRepository.layer, NotificationsRepository.layer),
	),
);
