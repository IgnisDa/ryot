import { Context, Effect, Layer, Ref, Schema } from "effect";

import { JobQueue } from "#platform/jobs/queue";

import { AutomationRunPayload } from "./run-job";

type RunJobSubmission = {
	readonly kind: string;
	readonly key: string | undefined;
	readonly payload: AutomationRunPayload;
};

export class RunJobSubmissions extends Context.Service<
	RunJobSubmissions,
	Effect.Effect<ReadonlyArray<RunJobSubmission>>
>()("@ryot-app/kernel-backend/modules/automations/run-job-queue.test-support/RunJobSubmissions") {}

export const recordingRunJobQueueLayer = Layer.effectContext(
	Effect.gen(function* () {
		const submissions = yield* Ref.make<ReadonlyArray<RunJobSubmission>>([]);
		return Context.make(
			JobQueue,
			JobQueue.of({
				pruneFailed: () => Effect.void,
				enqueue: (kind, payload, options) =>
					Effect.gen(function* () {
						const submission = {
							kind: kind.name,
							key: options?.key,
							payload: yield* Schema.decodeUnknownEffect(AutomationRunPayload)(payload),
						};
						yield* Ref.update(submissions, (all) => [...all, submission]);
						return true;
					}),
			}),
		).pipe(Context.add(RunJobSubmissions, Ref.get(submissions)));
	}),
);
