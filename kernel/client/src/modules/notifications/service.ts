import type { ContractSuccess } from "@ryot-app/contract/client";
import type {
	CreateNotificationChannelBody,
	TestNotificationChannelsBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import {
	createRyotHostMutation,
	createRyotHostQuery,
	createRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { notificationChannelsRecipe } from "@ryot-app/ryotql-recipes/notification-channels";
import type { NotificationChannelsResult } from "@ryot-app/ryotql-recipes/notification-channels";
import {
	notificationOutcomeRecipe,
	type NotificationOutcomeResult,
} from "@ryot-app/ryotql-recipes/notification-delivery";
import { Context, Effect, Layer, Schema } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { NotificationsApi } from "#/api/notifications";
import { PublicApi } from "#/api/public";
import type { KernelRyotClient } from "#/api/ryot-client";
import { KernelHostServices } from "#/host-services";

export const NOTIFICATION_CHANNELS_PAGE_SIZE = 20;

type NotificationChannelsClient = Pick<KernelRyotClient, "data">;

export class NotificationChannelsLoadError extends Schema.TaggedError<
	NotificationChannelsLoadError,
	{ readonly brand: unique symbol }
>()("NotificationChannelsLoadError", { cause: Schema.Unknown }) {}

export class NotificationDeliveryLoadError extends Schema.TaggedError<
	NotificationDeliveryLoadError,
	{ readonly brand: unique symbol }
>()("NotificationDeliveryLoadError", { cause: Schema.Unknown }) {}

export const notificationOutcomeQuery = createRyotQuery<
	string,
	NotificationOutcomeResult,
	NotificationDeliveryLoadError
>(
	({ input, client }) =>
		client.data
			.query(notificationOutcomeRecipe({ id: input }))
			.pipe(Effect.mapError((cause) => new NotificationDeliveryLoadError({ cause }))),
	{ cancelOnUnmount: true },
);

export class NotificationChannelsService extends Context.Service<NotificationChannelsService>()(
	"@ryot-app/kernel-client/modules/notifications/service/NotificationChannelsService",
	{
		make: Effect.sync(() => {
			const loadChannels = Effect.fn("NotificationChannelsService.loadChannels")(function* (
				client: NotificationChannelsClient,
				input: { readonly limit: number },
			) {
				return yield* client.data
					.query(notificationChannelsRecipe({ limit: input.limit }))
					.pipe(Effect.mapError((cause) => new NotificationChannelsLoadError({ cause })));
			});

			return { loadChannels };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const notificationChannelsQuery = createRyotHostQuery<
	number,
	NotificationChannelsResult,
	KernelHostServices,
	NotificationChannelsLoadError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(NotificationChannelsService)
			.loadChannels(client, { limit: input }),
	{ cancelOnUnmount: true, hostServices: KernelHostServices },
);

export const notificationSmtpEnabledQuery = createRyotHostQuery<void, boolean, KernelHostServices>(
	({ hostServices }) =>
		hostServices.runtime
			.runSync(PublicApi)
			.getSystemConfig(hostServices.scope.serverUrl)
			.pipe(
				Effect.match({
					onFailure: () => false,
					onSuccess: (config) => config.notifications.smtpEnabled,
				}),
			),
	{ cancelOnUnmount: true, hostServices: KernelHostServices },
);

export const testNotificationChannelsMutation = createRyotHostMutation<
	TestNotificationChannelsBody,
	ContractSuccess<"notifications", "testChannels">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(NotificationsApi)
			.testChannels(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const createNotificationChannelMutation = createRyotHostMutation<
	CreateNotificationChannelBody,
	ContractSuccess<"notifications", "createChannel">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(NotificationsApi)
			.createChannel(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const updateNotificationChannelMutation = createRyotHostMutation<
	{ readonly id: string; readonly isDisabled: boolean },
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(NotificationsApi)
			.updateChannel(hostServices.scope, {
				payload: { isDisabled: input.isDisabled },
				params: { channelId: NotificationChannelId.make(input.id) },
			})
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const deleteNotificationChannelMutation = createRyotHostMutation<
	string,
	ContractSuccess<"notifications", "deleteChannel">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(NotificationsApi)
			.deleteChannel(hostServices.scope, {
				params: { channelId: NotificationChannelId.make(input) },
			})
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
