import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";

import { UserBootstrap } from "./bootstrap";
import { runUserBootstrapJob } from "./job";

const userId = UserId.make("user-1");
const payload = { userId, accountUserId: userId };
const job = { attempt: 1, id: "user-bootstrap-job" };

const provideBootstrap =
	(perform: UserBootstrap["Service"]["perform"], lifecycleActive = false) =>
	(effect: ReturnType<typeof runUserBootstrapJob>) =>
		effect.pipe(
			Effect.provideService(
				LifecycleWriteGuard,
				LifecycleWriteGuard.of({ isActive: () => Effect.succeed(lifecycleActive) }),
			),
			Effect.provideService(
				UserBootstrap,
				UserBootstrap.of({ perform, listIncomplete: () => Effect.succeed([]) }),
			),
		);

it.effect(
	"bootstraps the payload's user",
	() =>
		Effect.gen(function* () {
			const performed: Array<string> = [];
			yield* runUserBootstrapJob(payload, job).pipe(
				provideBootstrap((user) => Effect.sync(() => void performed.push(user))),
			);
			expect(performed).toEqual([userId]);
		}),
	testTimeout,
);

it.effect(
	"fails the attempt when bootstrap fails",
	() =>
		Effect.gen(function* () {
			const exit = yield* runUserBootstrapJob(payload, job).pipe(
				provideBootstrap(() =>
					Effect.fail(new DbError({ message: "temporary bootstrap failure" })),
				),
				Effect.exit,
			);
			expect(exit._tag).toBe("Failure");
		}),
	testTimeout,
);

it.effect(
	"leaves the bootstrap of a user under a lifecycle operation to that operation",
	() =>
		runUserBootstrapJob(payload, job).pipe(
			provideBootstrap(() => Effect.die("bootstrap ran under a lifecycle operation"), true),
		),
	testTimeout,
);
