import { notificationChannelsRecipe } from "@ryot-app/ryotql-recipes/notification-channels";
import { Context, Data, Effect, Layer } from "effect";

import type { KernelRyotClient } from "#/api/ryot-client";

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
