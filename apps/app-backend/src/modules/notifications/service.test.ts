import { expect, it } from "@effect/vitest";
import { NotificationPlatformId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer } from "#lib/test-support/effect";

import { NotificationDeliveryService } from "./delivery";
import type { NotificationPlatformRecord } from "./repository";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

const userId = UserId.make("user-1");
const now = "2026-07-10T00:00:00.000Z";

const makePlatform = (
	id: string,
	configuredEvents: NotificationPlatformRecord["configuredEvents"],
): NotificationPlatformRecord => ({
	userId,
	updatedAt: now,
	createdAt: now,
	configuredEvents,
	isDisabled: false,
	platform: "apprise",
	id: NotificationPlatformId.make(id),
	description: "Apprise at http://localhost:1234",
	platformSpecifics: { baseUrl: "http://localhost:1234", key: "key", kind: "apprise" },
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
			const service = yield* NotificationsService;
			const result = yield* service.triggerForUser({
				userId,
				eventType: "review_posted",
				message: "A review was posted",
			});

			expect(calls).toEqual(["apprise", "apprise"]);
			expect(requests).toEqual([{ eventType: "review_posted", userId }]);
			expect(result).toEqual([
				{ platform: "apprise", platformId: first.id, status: "failed" },
				{ platform: "apprise", platformId: second.id, status: "sent" },
			]);
		}).pipe(
			Effect.provide(
				Layer.provide(
					NotificationsService.Default,
					Layer.mergeAll(dbRunnerLayer, repositoryLayer, deliveryLayer),
				),
			),
		);
	},
);
