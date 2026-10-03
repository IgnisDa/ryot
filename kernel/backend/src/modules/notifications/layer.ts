import { Layer } from "effect";

import { NotificationDeliveryService, NotificationMailer } from "./delivery";
import { NotificationDeliveryWorkflowDefinitionsLive } from "./notification-delivery-workflow-live";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

export const NotificationsServiceLive = NotificationsService.layer.pipe(
	Layer.provide(NotificationsRepository.layer),
);

export const NotificationDeliveryServiceLive = NotificationDeliveryService.layer.pipe(
	Layer.provide(NotificationMailer.layer),
);

export const NotificationDeliveryWorkflowDefinitionsProvidedLive =
	NotificationDeliveryWorkflowDefinitionsLive.pipe(Layer.provide(NotificationsRepository.layer));
