import { expect, it } from "@effect/vitest";
import { NotificationPlatformId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer } from "#lib/test-support/effect";

import { deliverEnabledPlatforms } from "./deliver-enabled-platforms";
import { NotificationDeliveryService } from "./delivery";
import type { NotificationPlatformRecord } from "./repository";
import { NotificationsRepository } from "./repository";

const userId = UserId.make("user-1");
const now = "2026-07-10T00:00:00.000Z";

const makePlatform = (
	id: string,
	configuredEvents: NotificationPlatformRecord["configuredEvents"],
	specifics: NotificationPlatformRecord["platformSpecifics"] = {
		key: "key",
		kind: "apprise",
		baseUrl: "http://localhost:1234",
	},
): NotificationPlatformRecord => ({
	userId,
	updatedAt: now,
	createdAt: now,
	configuredEvents,
	isDisabled: false,
	platform: specifics.kind,
	platformSpecifics: specifics,
	description: "configured endpoint",
	id: NotificationPlatformId.make(id),
});

const makeRepositoryLayer = (platforms: NotificationPlatformRecord[], requests: unknown[]) =>
	Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {
			listEnabledForUser: (input: { eventType?: string; userId: UserId }) => {
				requests.push(input);
				return Effect.succeed(platforms);
			},
		}),
	);

const makeDeliveryLayer = (failOnCall: number, calls: string[]) =>
	Layer.succeed(
		NotificationDeliveryService,
		Object.assign(Object.create(null), {
			send: (input: { platformSpecifics: NotificationPlatformRecord["platformSpecifics"] }) => {
				const id = input.platformSpecifics.kind;
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
		const first = makePlatform("platform-1", ["review_posted"]);
		const second = makePlatform("platform-2", ["review_posted"]);
		const repositoryLayer = makeRepositoryLayer([first, second], requests);

		return Effect.gen(function* () {
			const result = yield* deliverEnabledPlatforms({
				userId,
				executionId: "execution-1",
				request: { kind: "event", eventType: "review_posted", message: "A review was posted" },
			});

			expect(calls).toEqual(["apprise", "apprise"]);
			expect(requests).toEqual([{ eventType: "review_posted", userId }]);
			expect(result).toEqual([
				{ platform: "apprise", platformId: first.id, status: "failed" },
				{ platform: "apprise", platformId: second.id, status: "sent" },
			]);
		}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
	},
);

it.effect("sends a per-platform test message and does not filter by event type", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const deliveryLayer = makeDeliveryLayer(-1, calls);
	const platform = makePlatform("platform-1", ["review_posted"]);
	const repositoryLayer = makeRepositoryLayer([platform], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledPlatforms({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(requests).toEqual([{ eventType: undefined, userId }]);
		expect(result).toEqual([{ platform: "apprise", platformId: platform.id, status: "sent" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});

it.effect("reports an unavailable delivery as failed", () => {
	const calls: string[] = [];
	const requests: unknown[] = [];
	const deliveryLayer = makeDeliveryLayer(0, calls);
	const platform = makePlatform("platform-1", ["review_posted"], {
		kind: "email",
		recipient: "recipient@example.com",
	});
	const repositoryLayer = makeRepositoryLayer([platform], requests);

	return Effect.gen(function* () {
		const result = yield* deliverEnabledPlatforms({
			userId,
			request: { kind: "test" },
			executionId: "execution-1",
		});

		expect(result).toEqual([{ platform: "email", platformId: platform.id, status: "failed" }]);
	}).pipe(Effect.provide(Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer)));
});
