import { expect, layer } from "@effect/vitest";
import { NotificationChannelId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import { NotificationDeliveryService } from "./delivery";
import type { NotificationChannelRecord } from "./repository";
import { NotificationsRepository } from "./repository";

const userId = UserId.make("user-1");
const now = "2026-07-10T00:00:00.000Z";

const makeChannel = (
	id: string,
	specifics: NotificationChannelRecord["channelSpecifics"] = {
		key: "key",
		kind: "apprise",
		baseUrl: "http://localhost:1234",
	},
): NotificationChannelRecord => ({
	userId,
	updatedAt: now,
	createdAt: now,
	isDisabled: false,
	channel: specifics.kind,
	channelSpecifics: specifics,
	description: "configured endpoint",
	id: NotificationChannelId.make(id),
});

class FakeNotificationChannels extends Context.Service<
	FakeNotificationChannels,
	{
		readonly requests: Effect.Effect<ReadonlyArray<{ userId: UserId }>>;
		readonly deliveredKinds: Effect.Effect<ReadonlyArray<string>>;
		readonly deliveredMessages: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/FakeNotificationChannels") {}

const fakeChannelsLayer = (
	channels: ReadonlyArray<NotificationChannelRecord>,
	failOnCall: number,
) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<{ userId: UserId }>>([]);
			const kinds = yield* Ref.make<ReadonlyArray<string>>([]);
			const messages = yield* Ref.make<ReadonlyArray<string>>([]);
			return Context.make(
				NotificationsRepository,
				Object.assign(Object.create(null), {
					listEnabledForUser: (input: { userId: UserId }) =>
						Ref.update(requests, (all) => [...all, input]).pipe(Effect.as(channels)),
				}),
			).pipe(
				Context.add(
					NotificationDeliveryService,
					Object.assign(Object.create(null), {
						send: (input: {
							message: string;
							channelSpecifics: NotificationChannelRecord["channelSpecifics"];
						}) =>
							Effect.gen(function* () {
								const shouldFail = yield* Ref.modify(kinds, (all) => [
									all.length === failOnCall,
									[...all, input.channelSpecifics.kind],
								]);
								yield* Ref.update(messages, (all) => [...all, input.message]);
								return shouldFail
									? yield* Effect.fail({
											message: "failed",
											_tag: "NotificationDeliveryError",
										} as const)
									: undefined;
							}),
					}),
				),
				Context.add(FakeNotificationChannels, {
					requests: Ref.get(requests),
					deliveredKinds: Ref.get(kinds),
					deliveredMessages: Ref.get(messages),
				}),
			);
		}),
	);

const deliveryLayer = (channels: ReadonlyArray<NotificationChannelRecord>, failOnCall: number) =>
	Layer.merge(databaseLayer, fakeChannelsLayer(channels, failOnCall));

const first = makeChannel("channel-1");
const second = makeChannel("channel-2");
const emailChannel = makeChannel("channel-2", {
	kind: "email",
	recipient: "recipient@example.com",
});
const unavailableEmailChannel = makeChannel("channel-1", {
	kind: "email",
	recipient: "recipient@example.com",
});

layer(deliveryLayer([first, second], 0))((test) => {
	test.effect(
		"sends message deliveries to every enabled channel and returns best-effort outcomes",
		() =>
			Effect.gen(function* () {
				const result = yield* deliverEnabledChannels({
					userId,
					executionId: "execution-1",
					request: { kind: "message", message: "A review was posted" },
				});

				const fake = yield* FakeNotificationChannels;
				expect(yield* fake.deliveredKinds).toEqual(["apprise", "apprise"]);
				expect(yield* fake.requests).toEqual([{ userId }]);
				expect(result).toEqual([
					{ status: "failed", channel: "apprise", channelId: first.id },
					{ status: "sent", channel: "apprise", channelId: second.id },
				]);
			}),
	);
});

layer(deliveryLayer([first], -1))((test) => {
	test.effect("sends a per-channel test message", () =>
		Effect.gen(function* () {
			const result = yield* deliverEnabledChannels({
				userId,
				request: { kind: "test" },
				executionId: "execution-1",
			});

			expect(yield* (yield* FakeNotificationChannels).requests).toEqual([{ userId }]);
			expect(result).toEqual([{ status: "sent", channel: "apprise", channelId: first.id }]);
		}),
	);
});

layer(deliveryLayer([first, emailChannel], -1))((test) => {
	test.effect("preserves the message for every enabled channel", () =>
		Effect.gen(function* () {
			const result = yield* deliverEnabledChannels({
				userId,
				executionId: "execution-1",
				request: { kind: "message", message: "Subscription run completed" },
			});

			const fake = yield* FakeNotificationChannels;
			expect(yield* fake.deliveredKinds).toEqual(["apprise", "email"]);
			expect(yield* fake.requests).toEqual([{ userId }]);
			expect(yield* fake.deliveredMessages).toEqual([
				"Subscription run completed",
				"Subscription run completed",
			]);
			expect(result).toEqual([
				{ status: "sent", channel: "apprise", channelId: first.id },
				{ status: "sent", channel: "email", channelId: emailChannel.id },
			]);
		}),
	);
});

layer(deliveryLayer([], -1))((test) => {
	test.effect("completes message delivery when no channels are enabled", () =>
		Effect.gen(function* () {
			const result = yield* deliverEnabledChannels({
				userId,
				executionId: "execution-1",
				request: { kind: "message", message: "Subscription run completed" },
			});

			const fake = yield* FakeNotificationChannels;
			expect(yield* fake.deliveredKinds).toEqual([]);
			expect(yield* fake.requests).toEqual([{ userId }]);
			expect(result).toEqual([]);
		}),
	);
});

layer(deliveryLayer([unavailableEmailChannel], 0))((test) => {
	test.effect("reports an unavailable delivery as failed", () =>
		Effect.gen(function* () {
			const result = yield* deliverEnabledChannels({
				userId,
				request: { kind: "test" },
				executionId: "execution-1",
			});

			expect(result).toEqual([
				{ channel: "email", status: "failed", channelId: unavailableEmailChannel.id },
			]);
		}),
	);
});
