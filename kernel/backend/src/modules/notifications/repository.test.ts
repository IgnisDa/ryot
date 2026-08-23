import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { withRevisionDatabase } from "#modules/plugins/revision.test-support";

import { NotificationsRepository } from "./repository";

it.effect("updates only owned channels without returning channel details or secrets", () =>
	withRevisionDatabase(
		Effect.gen(function* () {
			const repository = yield* NotificationsRepository;
			const owner = UserId.make("owner");
			const other = UserId.make("recipient");
			const created = yield* repository.createForUser({
				userId: owner,
				isDisabled: false,
				channel: "telegram",
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
			expect(
				yield* repository.updateForUser({
					userId: owner,
					channelId: created.id,
					body: { isDisabled: true },
				}),
			).toEqual({ id: created.id });
			expect(yield* repository.listEnabledForUser({ userId: owner })).toEqual([]);
		}).pipe(Effect.provide(NotificationsRepository.layer)),
	),
);
