import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import { PluginBootstrapEntities } from "#modules/plugins/installations/bootstrap-entities";
import { makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { UserBootstrap } from "./bootstrap";

const UserBootstrapPayload = Schema.Struct({ userId: UserId, accountUserId: UserId });
type UserBootstrapPayload = typeof UserBootstrapPayload.Type;

export const UserBootstrapJob = makeJobKind("user-bootstrap", {
	concurrency: 4,
	maxAttempts: 10,
	payload: UserBootstrapPayload,
});

export const bootstrapUser = Effect.fn("bootstrapUser")(function* (
	userId: UserId,
	accountUserId: UserId,
) {
	const bootstrap = yield* UserBootstrap;
	const bootstrapEntities = yield* PluginBootstrapEntities;
	const plans = yield* bootstrap.perform(userId, accountUserId);
	yield* bootstrapEntities
		.dispatch(plans)
		.pipe(
			Effect.catchCause((cause) => Effect.logError("user bootstrap hook dispatch failed", cause)),
		);
});

export const runUserBootstrapJob = Effect.fn("UserBootstrapJob")(function* (
	payload: UserBootstrapPayload,
	job: JobContext,
) {
	yield* Effect.annotateCurrentSpan({ jobId: job.id, userId: payload.userId });
	yield* bootstrapUser(payload.userId, payload.accountUserId);
});

export const UserBootstrapJobLive = registerJobHandler(UserBootstrapJob, runUserBootstrapJob);
