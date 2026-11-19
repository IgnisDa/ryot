import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { PluginBootstrapEntities } from "#modules/plugins/installations/bootstrap-entities";

import { UserBootstrap } from "./bootstrap";
import { runUserBootstrapJob } from "./job";

const userId = UserId.make("user-1");
const payload = { userId, accountUserId: userId };
const job = { attempt: 1, id: "user-bootstrap-job" };

const provideBootstrap =
	(perform: UserBootstrap["Service"]["perform"], dispatched: Array<ReadonlyArray<unknown>>) =>
	(effect: ReturnType<typeof runUserBootstrapJob>) =>
		effect.pipe(
			Effect.provideService(
				UserBootstrap,
				UserBootstrap.of({ perform, listIncomplete: () => Effect.succeed([]) }),
			),
			Effect.provideService(
				PluginBootstrapEntities,
				PluginBootstrapEntities.of({
					ensure: () => Effect.succeed([]),
					dispatch: (plans) => Effect.sync(() => void dispatched.push(plans)),
				}),
			),
		);

it.effect(
	"dispatches the plans of a completed bootstrap",
	() =>
		Effect.gen(function* () {
			const dispatched: Array<ReadonlyArray<unknown>> = [];
			yield* runUserBootstrapJob(payload, job).pipe(
				provideBootstrap(() => Effect.succeed(["plan"]), dispatched),
			);
			expect(dispatched).toEqual([["plan"]]);
		}),
	testTimeout,
);

it.effect(
	"fails the attempt without dispatching when bootstrap fails",
	() =>
		Effect.gen(function* () {
			const dispatched: Array<ReadonlyArray<unknown>> = [];
			const exit = yield* runUserBootstrapJob(payload, job).pipe(
				provideBootstrap(
					() => Effect.fail(new DbError({ message: "temporary bootstrap failure" })),
					dispatched,
				),
				Effect.exit,
			);
			expect(exit._tag).toBe("Failure");
			expect(dispatched).toEqual([]);
		}),
	testTimeout,
);
