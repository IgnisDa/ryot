import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

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
	preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
} satisfies CurrentUserValue;

class RecordedAdmissions extends Context.Service<
	RecordedAdmissions,
	{ readonly inputs: Effect.Effect<ReadonlyArray<NotificationAdmission>> }
>()("@ryot-app/kernel-backend/modules/notifications/service.test/RecordedAdmissions") {}

const admissions = Layer.effectContext(
	Effect.gen(function* () {
		const inputs = yield* Ref.make<ReadonlyArray<NotificationAdmission>>([]);
		return Context.make(NotificationAdmissions, {
			pruneDiagnostics: () => Effect.void,
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
	test.effect(
		"admits a channel test and returns its notification",
		() =>
			Effect.gen(function* () {
				const service = yield* NotificationsService;
				expect(yield* service.test(user)).toEqual({ id: "admitted-notification" });
				expect(yield* (yield* RecordedAdmissions).inputs).toMatchObject([
					{
						userId: user.id,
						sourceRunId: null,
						accountUserId: user.id,
						sourceSubmittedAt: null,
						request: { kind: "test" },
					},
				]);
			}),
		testTimeout,
	);
	test.effect(
		"forwards trusted run and call authority, normalizing message content",
		() =>
			Effect.gen(function* () {
				const service = yield* NotificationsService;
				yield* service.sendMessage({
					sourceRunId: "run-1",
					accountUserId: user.id,
					sourceKey: "run-1-host-3-notification",
					message: "  Subscription run completed  ",
				});
				expect((yield* (yield* RecordedAdmissions).inputs).at(-1)).toEqual({
					userId: user.id,
					sourceRunId: "run-1",
					accountUserId: user.id,
					sourceSubmittedAt: null,
					sourceKey: "run-1-host-3-notification",
					request: { kind: "message", message: "Subscription run completed" },
				});
			}),
		testTimeout,
	);
});
