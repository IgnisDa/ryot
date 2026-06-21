import { expect, it } from "@effect/vitest";
import { NotificationChannelId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer } from "#lib/test-support/effect";

import { deliverEnabledChannels } from "./deliver-enabled-channels";
import { NotificationDeliveryService } from "./delivery";
import type { NotificationChannelRecord } from "./repository";
import { NotificationsRepository } from "./repository";

const userId = UserId.make("user-1");
const now = "2026-07-10T00:00:00.000Z";

const makeChannel = (
	id: string,
	configuredEvents: NotificationChannelRecord["configuredEvents"],
	specifics: NotificationChannelRecord["channelSpecifics"] = {
		key: "key",
		kind: "apprise",
		baseUrl: "http://localhost:1234",
	},
): NotificationChannelRecord => ({
	userId,
	updatedAt: now,
	createdAt: now,
	configuredEvents,
	isDisabled: false,
	channel: specifics.kind,
	channelSpecifics: specifics,
	description: "configured endpoint",
	id: NotificationChannelId.make(id),
});

const makeRepositoryLayer = (channels: NotificationChannelRecord[], requests: unknown[]) =>
	Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {
			listEnabledForUser: (input: { eventType?: string; userId: UserId }) => {
				requests.push(input);
				return Effect.succeed(channels);
			},
		}),
	);

const makeDeliveryLayer = (failOnCall: number, calls: string[]) =>
	Layer.succeed(
		NotificationDeliveryService,
		Object.assign(Object.create(null), {
			send: (input: { channelSpecifics: NotificationChannelRecord["channelSpecifics"] }) => {
				const id = input.channelSpecifics.kind;
				const shouldFail = calls.length === failOnCall;
				calls.push(id);
				return shouldFail
					? Effect.fail({ _tag: "NotificationDeliveryError", message: "failed" } as const)
					: Effect.void;
			},
		}),
	);

it.effect(
	"filters event deliveries in the repository request and returns best-effort outcomes",
	() => {
		const calls: string[] = [];
		const requests: unknown[] = [];
		const deliveryLayer = makeDeliveryLayer(0, calls);
		const first = makeChannel("channel-1", ["review_posted"]);
		const second = makeChannel("channel-2", ["review_posted"]);
		const repositoryLayer = makeRepositoryLayer([first, second], requests);

		return Effect.gen(function* () {
			const result = yield* deliverEnabledChannels({
				userId,
				executionId: "execution-1",
				request: { kind: "event", eventType: "review_posted", message: "A review was posted" },
			});

			expect(calls).toEqual(["apprise", "apprise"]);
			expect(requests).toEqual([{ eventType: "review_posted", userId }]);
			expect(result).toEqual([
				{ channel: "apprise", channelId: first.id, status: "failed" },
				{ channel: "apprise", channelId: second.id, status: "sent" },
			]);
		}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
	},
);

it.effect("sends a per-channel test message and does not filter by event type", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const deliveryLayer = makeDeliveryLayer(-1, calls);
	const channel = makeChannel("channel-1", ["review_posted"]);
	const repositoryLayer = makeRepositoryLayer([channel], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledChannels({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(requests).toEqual([{ eventType: undefined, userId }]);
		expect(result).toEqual([{ channel: "apprise", channelId: channel.id, status: "sent" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});

it.effect("reports an unavailable delivery as failed", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const deliveryLayer = makeDeliveryLayer(0, calls);
	const channel = makeChannel("channel-1", ["review_posted"], {
		kind: "email",
		recipient: "recipient@example.com",
	});
	const repositoryLayer = makeRepositoryLayer([channel], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledChannels({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(result).toEqual([{ channel: "email", channelId: channel.id, status: "failed" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});
