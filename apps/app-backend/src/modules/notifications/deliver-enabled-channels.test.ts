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
	specifics: NotificationChannelRecord["specifics"] = {
		key: "key",
		kind: "apprise",
		baseUrl: "http://localhost:1234",
	},
): NotificationChannelRecord => ({
	userId,
	specifics,
	updatedAt: now,
	createdAt: now,
	isDisabled: false,
	kind: specifics.kind,
	description: "configured endpoint",
	id: NotificationChannelId.make(id),
});

const makeRepositoryLayer = (channels: NotificationChannelRecord[], requests: unknown[]) =>
	Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {
			listEnabledForUser: (requestedUserId: UserId) => {
				requests.push(requestedUserId);
				return Effect.succeed(channels);
			},
		}),
	);

const makeDeliveryLayer = (failOnCall: number, calls: string[]) =>
	Layer.succeed(
		NotificationDeliveryService,
		Object.assign(Object.create(null), {
			send: (input: { specifics: NotificationChannelRecord["specifics"] }) => {
				const id = input.specifics.kind;
				const shouldFail = calls.length === failOnCall;
				calls.push(id);
				return shouldFail
					? Effect.fail({ _tag: "NotificationDeliveryError", message: "failed" } as const)
					: Effect.void;
			},
		}),
	);

it.effect("delivers an automation notification to every enabled channel", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const first = makeChannel("channel-1");
	const second = makeChannel("channel-2");
	const deliveryLayer = makeDeliveryLayer(0, calls);
	const repositoryLayer = makeRepositoryLayer([first, second], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledChannels({
			userId,
			executionId: "execution-1",
			request: { kind: "automation", message: "A review was created" },
		});

		expect(calls).toEqual(["apprise", "apprise"]);
		expect(requests).toEqual([userId]);
		expect(result).toEqual([
			{ kind: "apprise", channelId: first.id, status: "failed" },
			{ kind: "apprise", channelId: second.id, status: "sent" },
		]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});

it.effect("sends a per-channel test message", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const channel = makeChannel("channel-1");
	const deliveryLayer = makeDeliveryLayer(-1, calls);
	const repositoryLayer = makeRepositoryLayer([channel], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledChannels({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(requests).toEqual([userId]);
		expect(result).toEqual([{ kind: "apprise", channelId: channel.id, status: "sent" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});

it.effect("reports an unavailable channel as failed", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const channel = makeChannel("channel-1", {
		kind: "email",
		recipient: "recipient@example.com",
	});
	const deliveryLayer = makeDeliveryLayer(0, calls);
	const repositoryLayer = makeRepositoryLayer([channel], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledChannels({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(result).toEqual([{ kind: "email", channelId: channel.id, status: "failed" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});
