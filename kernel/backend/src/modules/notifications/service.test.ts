import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";

import { NotificationAdmissions } from "./admission";
import type { NotificationAdmission } from "./ledger";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	id: UserId.make("owner"),
	email: "user@example.com",
	preferences: { language: null, reportingTimeZone: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("owner"), token: "test-account-generation" },
} satisfies CurrentUserValue;

class RecordedAdmissions extends Context.Service<
	RecordedAdmissions,
	{ readonly inputs: Effect.Effect<ReadonlyArray<NotificationAdmission>> }
>()("@ryot-app/kernel-backend/modules/notifications/service.test/RecordedAdmissions") {}

const admissions = Layer.effectContext(
	Effect.gen(function* () {
		const inputs = yield* Ref.make<ReadonlyArray<NotificationAdmission>>([]);
		return Context.make(NotificationAdmissions, {
			recover: () => Effect.void,
			admit: (input) =>
				Ref.update(inputs, (all) => [...all, input]).pipe(
					Effect.as({ id: "admitted-notification" }),
				),
		}).pipe(Context.add(RecordedAdmissions, { inputs: Ref.get(inputs) }));
	}),
);

layer(
	NotificationsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				admissions,
				NotificationsRepository.layer.pipe(Layer.provide(revisionDatabaseLayer)),
			),
		),
	),
)((test) => {
	test.effect("retains a channel test submission and returns its admitted notification", () =>
		Effect.gen(function* () {
			const service = yield* NotificationsService;
			const submittedAt = (yield* DateTime.nowAsDate).toISOString();
			expect(yield* service.test(user, { submittedAt, idempotencyKey: "test-1" })).toEqual({
				id: "admitted-notification",
			});
			expect(yield* (yield* RecordedAdmissions).inputs).toEqual([
				{
					userId: user.id,
					sourceRunId: null,
					request: { kind: "test" },
					sourceSubmittedAt: submittedAt,
					sourceKey: "channel-test:test-1",
					accountGeneration: user.accountGeneration,
				},
			]);
		}),
	);
	test.effect("forwards trusted run and call authority, normalizing message content", () =>
		Effect.gen(function* () {
			const service = yield* NotificationsService;
			yield* service.sendMessage({
				sourceRunId: "run-1",
				sourceKey: "run-1-host-3-notification",
				message: "  Subscription run completed  ",
				accountGeneration: user.accountGeneration,
			});
			expect((yield* (yield* RecordedAdmissions).inputs).at(-1)).toEqual({
				userId: user.id,
				sourceRunId: "run-1",
				sourceSubmittedAt: null,
				sourceKey: "run-1-host-3-notification",
				accountGeneration: user.accountGeneration,
				request: { kind: "message", message: "Subscription run completed" },
			});
		}),
	);
});
