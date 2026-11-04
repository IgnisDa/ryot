import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { JobQueue } from "#platform/jobs/queue";

import { UserBootstrap } from "./bootstrap";
import { UserBootstrapScheduling } from "./scheduling";

const userId = UserId.make("user-1");
const accountFor = (accountUserId: UserId) => ({
	userId: accountUserId,
	token: "test-account-generation",
});

type Enqueued = { readonly payload: unknown; readonly options: unknown };

class RecordedJobs extends Context.Service<
	RecordedJobs,
	{ readonly enqueued: Effect.Effect<ReadonlyArray<Enqueued>> }
>()("@ryot-app/kernel-backend/modules/accounts/provisioning/scheduling.test/RecordedJobs") {}

const recordingJobQueue = (fail: (payload: unknown) => boolean = () => false) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const enqueued = yield* Ref.make<ReadonlyArray<Enqueued>>([]);
			return Layer.mergeAll(
				Layer.succeed(RecordedJobs, { enqueued: Ref.get(enqueued) }),
				Layer.succeed(
					JobQueue,
					JobQueue.of({
						pruneFailed: () => Effect.void,
						enqueue: (_kind, payload, options) =>
							Ref.update(enqueued, (all) => [...all, { payload, options }]).pipe(
								Effect.andThen(
									fail(payload) ? Effect.die("queue unavailable") : Effect.succeed(true),
								),
							),
					}),
				),
			);
		}),
	);

const bootstrapJob = (jobUserId: UserId) => ({
	options: { userId: jobUserId, key: accountFor(jobUserId).token },
	payload: { userId: jobUserId, accountGeneration: accountFor(jobUserId) },
});

layer(
	UserBootstrapScheduling.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(Layer.mock(UserBootstrap)({}), recordingJobQueue())),
		Layer.provideMerge(mutationAdmissionTestLayer),
	),
)((test) => {
	test.effect(
		"queues the bootstrap under the account generation key",
		() =>
			Effect.gen(function* () {
				yield* (yield* UserBootstrapScheduling).schedule(userId);

				expect(yield* (yield* RecordedJobs).enqueued).toEqual([bootstrapJob(userId)]);
			}),
		testTimeout,
	);
});

const failedUserId = UserId.make("user-2");
const incomplete = [userId, failedUserId, UserId.make("user-3")];
const listedLimits: number[] = [];

const reconciliationLayer = UserBootstrapScheduling.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.mock(UserBootstrap)({
				listIncomplete: (limit) =>
					Effect.sync(() => {
						listedLimits.push(limit);
						return incomplete.map((id) => ({ id }));
					}),
			}),
			recordingJobQueue(
				(payload) =>
					typeof payload === "object" &&
					payload !== null &&
					"userId" in payload &&
					payload.userId === failedUserId,
			),
		),
	),
);

layer(reconciliationLayer.pipe(Layer.provideMerge(mutationAdmissionTestLayer)))((test) => {
	test.effect(
		"queues every incomplete user and contains one scheduling failure",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit((yield* UserBootstrapScheduling).reconcile(25));

				expect(exit._tag).toBe("Success");
				expect(listedLimits).toEqual([25]);
				expect(yield* (yield* RecordedJobs).enqueued).toEqual(incomplete.map(bootstrapJob));
			}),
		testTimeout,
	);
});
