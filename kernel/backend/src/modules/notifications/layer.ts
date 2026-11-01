import { Layer } from "effect";

import { MutationReceipts } from "#modules/mutations/receipts";

import { NotificationAdmissions } from "./admission";
import { NotificationDeliveryService, NotificationMailer } from "./delivery";
import { NotificationDeliveryRepository } from "./delivery-repository";
import { NotificationDeliveryWorkflowDefinitionsLive } from "./notification-delivery-workflow-live";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

export const NotificationAdmissionsLive = NotificationAdmissions.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			NotificationsRepository.layer,
			NotificationDeliveryRepository.layer,
			MutationReceipts.layer,
		),
	),
);

export const NotificationsServiceLive = NotificationsService.layer.pipe(
	Layer.provide(Layer.mergeAll(NotificationsRepository.layer, NotificationAdmissionsLive)),
);

export const NotificationDeliveryServiceLive = NotificationDeliveryService.layer.pipe(
	Layer.provide(NotificationMailer.layer),
);

export const NotificationDeliveryWorkflowDefinitionsProvidedLive =
	NotificationDeliveryWorkflowDefinitionsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				NotificationDeliveryRepository.layer,
				NotificationsRepository.layer,
				MutationReceipts.layer,
			),
		),
	);
