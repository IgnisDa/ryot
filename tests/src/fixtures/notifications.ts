import type { ContractPayload } from "@ryot/contract/client";
import { NotificationChannelId } from "@ryot/contract/schema/brands";
import {
	buildNotificationChannelsDocument,
	decodeNotificationChannelsResponse,
} from "@ryot/ryotql-recipes/notification-channels";
import { Effect } from "effect";

import { resultToEffect } from "~/support/assertions";
import { startFakeHttpServer } from "~/support/fake-http-server";

import type { Client } from "./auth";

type CreateNotificationChannelBody = ContractPayload<"notifications", "createChannel">;
type UpdateNotificationChannelBody = ContractPayload<"notifications", "updateChannel">;

export const createNotificationChannel = (client: Client, payload: CreateNotificationChannelBody) =>
	client.call((c) => c.notifications.createChannel({ payload }));

export const listNotificationChannels = (client: Client) =>
	Effect.gen(function* () {
		const response = yield* client.call((c) =>
			c.ryotql.execute({
				payload: buildNotificationChannelsDocument({ limit: 100, page: 1 }),
			}),
		);
		const decoded = yield* resultToEffect(decodeNotificationChannelsResponse(response));

		return decoded.items;
	});

export const updateNotificationChannel = (
	client: Client,
	channelId: string,
	payload: UpdateNotificationChannelBody,
) =>
	client.call((c) =>
		c.notifications.updateChannel({
			payload,
			params: { channelId: NotificationChannelId.make(channelId) },
		}),
	);

export const deleteNotificationChannel = (client: Client, channelId: string) =>
	client.call((c) =>
		c.notifications.deleteChannel({
			params: { channelId: NotificationChannelId.make(channelId) },
		}),
	);

export const testNotificationChannels = (client: Client) =>
	client.call((c) => c.notifications.testChannels());

export function startFakeAppriseServer() {
	return startFakeHttpServer((url) =>
		url.pathname.endsWith("/fail")
			? new Response("failed", { status: 500 })
			: Response.json({ ok: true }),
	);
}

export const startFakeAppriseServerScoped = Effect.acquireRelease(
	Effect.promise(() => startFakeAppriseServer()),
	(server) => Effect.sync(() => server.stop()),
);
