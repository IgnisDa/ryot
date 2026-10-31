import { expect, layer } from "@effect/vitest";
import type { NotificationChannelSpecifics } from "@ryot-app/contract/modules/notifications/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";

import { NotificationsRepository } from "./repository";

layer(NotificationsRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
	test.effect("derives every stored channel kind from its specifics and redacts descriptions", () =>
		Effect.gen(function* () {
			const repository = yield* NotificationsRepository;
			const userId = UserId.make("owner");
			const cases: ReadonlyArray<{
				description: string;
				channelSpecifics: NotificationChannelSpecifics;
			}> = [
				{
					description: "Apprise at https://apprise.example.com",
					channelSpecifics: {
						kind: "apprise",
						key: "secret-key",
						baseUrl: "https://user:password@apprise.example.com/private?token=secret",
					},
				},
				{
					description: "Discord webhook at https://discord.example.com",
					channelSpecifics: {
						kind: "discord",
						webhookUrl: "https://discord.example.com/private/secret-token",
					},
				},
				{
					description: "Email to r***@example.com",
					channelSpecifics: { kind: "email", recipient: "recipient@example.com" },
				},
				{
					description: "Gotify at https://gotify.example.com",
					channelSpecifics: {
						kind: "gotify",
						token: "secret-token",
						baseUrl: "https://gotify.example.com/private",
					},
				},
				{
					description: "ntfy at https://ntfy.sh",
					channelSpecifics: { kind: "ntfy", topic: "private-topic", accessToken: "secret-token" },
				},
				{
					description: "PushBullet configured",
					channelSpecifics: { kind: "push_bullet", accessToken: "secret-token" },
				},
				{
					description: "PushOver configured",
					channelSpecifics: { kind: "push_over", userKey: "secret-user", appToken: "secret-app" },
				},
				{
					description: "PushSafer configured",
					channelSpecifics: { key: "secret-key", kind: "push_safer" },
				},
				{
					description: "Telegram chat ending in 7890",
					channelSpecifics: { kind: "telegram", chatId: "1234567890", botToken: "secret-bot" },
				},
			];
			for (const { description, channelSpecifics } of cases) {
				const created = yield* repository.createForUser({
					userId,
					channelSpecifics,
					isDisabled: false,
				});
				expect(created.channel).toBe(channelSpecifics.kind);
				expect(created.channelSpecifics).toEqual(channelSpecifics);
				expect(created.description).toBe(description);
				expect(yield* repository.listEnabledForUser({ userId })).toEqual([created]);
				expect(yield* repository.listEnabledForUser({ userId: UserId.make("recipient") })).toEqual(
					[],
				);
				expect(yield* repository.deleteForUser({ userId, channelId: created.id })).toBe(true);
			}
		}),
	);

	test.effect("keeps channels created disabled out of delivery reads", () =>
		Effect.gen(function* () {
			const repository = yield* NotificationsRepository;
			const userId = UserId.make("owner");
			const created = yield* repository.createForUser({
				userId,
				isDisabled: true,
				channelSpecifics: { kind: "ntfy", topic: "private-topic" },
			});
			expect(created.channel).toBe("ntfy");
			expect(created.isDisabled).toBe(true);
			expect(yield* repository.listEnabledForUser({ userId })).toEqual([]);
			expect(yield* repository.deleteForUser({ userId, channelId: created.id })).toBe(true);
		}),
	);

	test.effect("updates only owned channels without returning channel details or secrets", () =>
		Effect.gen(function* () {
			const repository = yield* NotificationsRepository;
			const owner = UserId.make("owner");
			const other = UserId.make("recipient");
			const created = yield* repository.createForUser({
				userId: owner,
				isDisabled: false,
				channelSpecifics: { kind: "telegram", chatId: "123456", botToken: "secret-bot-token" },
			});

			expect(
				yield* repository.updateForUser({ body: {}, userId: other, channelId: created.id }),
			).toBeNull();
			expect(
				yield* repository.updateForUser({
					userId: other,
					channelId: created.id,
					body: { isDisabled: true },
				}),
			).toBeNull();
			expect(
				yield* repository.updateForUser({ body: {}, userId: owner, channelId: created.id }),
			).toEqual({ id: created.id });
			expect(yield* repository.listEnabledForUser({ userId: owner })).toEqual([created]);
			expect(yield* repository.listEnabledForUser({ userId: other })).toEqual([]);
			expect(yield* repository.deleteForUser({ userId: other, channelId: created.id })).toBe(false);
			expect(
				yield* repository.updateForUser({
					userId: owner,
					channelId: created.id,
					body: { isDisabled: true },
				}),
			).toEqual({ id: created.id });
			expect(yield* repository.listEnabledForUser({ userId: owner })).toEqual([]);
		}),
	);
});
