import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { ContractSuccess } from "@ryot-app/contract/client";
import type {
	CreateNotificationChannelBody,
	ListedNotificationChannel,
} from "@ryot-app/contract/modules/notifications/schemas";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import { notificationChannelsRecipe } from "@ryot-app/ryotql-recipes/notification-channels";
import type { NotificationChannelsResult } from "@ryot-app/ryotql-recipes/notification-channels";
import { Context, Data, Effect, Layer } from "effect";

import { NotificationsApi } from "#/api/notifications";
import { PublicApi } from "#/api/public";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";

export const NOTIFICATION_CHANNELS_PAGE_SIZE = 20;

type NotificationChannelsClient = Pick<KernelRyotClient, "data">;

export class NotificationChannelsLoadError extends Data.TaggedError(
	"NotificationChannelsLoadError",
)<{ readonly cause: unknown }> {}

export class NotificationChannelsService extends Context.Service<NotificationChannelsService>()(
	"NotificationChannelsService",
	{
		make: Effect.sync(() => {
			const loadChannels = Effect.fn("NotificationChannelsService.loadChannels")(function* (
				client: NotificationChannelsClient,
				input: { readonly limit: number },
			) {
				return yield* Effect.tryPromise({
					catch: (cause) => new NotificationChannelsLoadError({ cause }),
					try: (signal) =>
						client.data.query(notificationChannelsRecipe({ limit: input.limit }), { signal }),
				});
			});

			return { loadChannels };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const loadNotificationChannels = Effect.fnUntraced(function* (
	client: NotificationChannelsClient,
	input: { readonly limit: number },
) {
	const service = yield* NotificationChannelsService;
	return yield* service.loadChannels(client, input);
});

const getSystemConfig = Effect.fnUntraced(function* (serverUrl: ApiScope["serverUrl"]) {
	const api = yield* PublicApi;
	return yield* api.getSystemConfig(serverUrl);
});

const testNotificationChannels = Effect.fnUntraced(function* (scope: ApiScope) {
	const api = yield* NotificationsApi;
	return yield* api.testChannels(scope);
});

const createNotificationChannel = Effect.fnUntraced(function* (
	scope: ApiScope,
	payload: CreateNotificationChannelBody,
) {
	const api = yield* NotificationsApi;
	return yield* api.createChannel(scope, { payload });
});

const updateNotificationChannel = Effect.fnUntraced(function* (
	scope: ApiScope,
	channelId: string,
	isDisabled: boolean,
) {
	const api = yield* NotificationsApi;
	return yield* api.updateChannel(scope, {
		payload: { isDisabled },
		params: { channelId: NotificationChannelId.make(channelId) },
	});
});

const deleteNotificationChannel = Effect.fnUntraced(function* (scope: ApiScope, channelId: string) {
	const api = yield* NotificationsApi;
	return yield* api.deleteChannel(scope, {
		params: { channelId: NotificationChannelId.make(channelId) },
	});
});

export const notificationChannelsQuery = createRyotQuery<
	number,
	NotificationChannelsResult,
	KernelHostServices
>(
	({ input, client, signal, hostServices }) =>
		hostServices.runtime.runPromise(loadNotificationChannels(client, { limit: input }), { signal }),
	{ cancelOnUnmount: true },
);

export const notificationSmtpEnabledQuery = createRyotQuery<void, boolean, KernelHostServices>(
	({ signal, hostServices }) =>
		hostServices.runtime.runPromise(
			getSystemConfig(hostServices.scope.serverUrl).pipe(
				Effect.match({
					onFailure: () => false,
					onSuccess: (config) => config.notifications.smtpEnabled,
				}),
			),
			{ signal },
		),
	{ cancelOnUnmount: true },
);

export const testNotificationChannelsMutation = createRyotMutation<void, void, KernelHostServices>(
	async ({ client, signal, hostServices }) => {
		const result = await hostServices.runtime.runPromise(
			testNotificationChannels(hostServices.scope),
			{ signal },
		);
		client.mutationCompleted.hint();
		return result;
	},
);

export const createNotificationChannelMutation = createRyotMutation<
	CreateNotificationChannelBody,
	ContractSuccess<"notifications", "createChannel">,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		createNotificationChannel(hostServices.scope, input),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});

export const updateNotificationChannelMutation = createRyotMutation<
	{ readonly id: string; readonly isDisabled: boolean },
	ListedNotificationChannel,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		updateNotificationChannel(hostServices.scope, input.id, input.isDisabled),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});

export const deleteNotificationChannelMutation = createRyotMutation<
	string,
	ContractSuccess<"notifications", "deleteChannel">,
	KernelHostServices
>(async ({ input, client, signal, hostServices }) => {
	const result = await hostServices.runtime.runPromise(
		deleteNotificationChannel(hostServices.scope, input),
		{ signal },
	);
	client.mutationCompleted.hint();
	return result;
});
