import type { ContractPayload } from "@ryot-app/contract/client";
import { NotificationChannelId } from "@ryot-app/contract/schema/brands";
import { notificationChannelsRecipe } from "@ryot-app/ryotql-recipes/notification-channels";
import { Effect } from "effect";

import { startFakeHttpServer, startFakeHttpServerScoped } from "~/support/fake-http-server";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

type TestNotificationChannelsBody = ContractPayload<"notifications", "testChannels">;
type CreateNotificationChannelBody = ContractPayload<"notifications", "createChannel">;
type UpdateNotificationChannelBody = ContractPayload<"notifications", "updateChannel">;

export const createNotificationChannel = (client: Client, payload: CreateNotificationChannelBody) =>
	client.call((c) => c.notifications.createChannel({ payload }));

export const listNotificationChannels = (client: Client) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(client, notificationChannelsRecipe({ limit: 100 }));
		return result.items;
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
		c.notifications.deleteChannel({ params: { channelId: NotificationChannelId.make(channelId) } }),
	);

export const testNotificationChannels = (client: Client) => {
	const payload: TestNotificationChannelsBody = {
		idempotencyKey: crypto.randomUUID(),
		submittedAt: new Date().toISOString(),
	};
	return client.call((c) => c.notifications.testChannels({ payload }));
};

const respondToApprise = (url: URL) =>
	url.pathname.endsWith("/fail")
		? new Response("failed", { status: 500 })
		: Response.json({ ok: true });

export const startFakeAppriseServer = startFakeHttpServer(respondToApprise);

export const startFakeAppriseServerScoped = startFakeHttpServerScoped(respondToApprise);

export const runCalendarDeliveryScan = (client: Client) =>
	client.adminCall((c) => c.testSupport.runCalendarDeliveryScan());
