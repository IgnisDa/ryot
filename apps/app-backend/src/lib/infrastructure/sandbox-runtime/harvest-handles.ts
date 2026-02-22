import { generateId } from "better-auth";
import { Context, Data, Effect, Layer } from "effect";

import { redisKeys, RedisService } from "../redis";
import { SANDBOX_LIMITS } from "./limits";

export class SandboxHarvestHandleNotFoundError extends Data.TaggedError(
	"SandboxHarvestHandleNotFoundError",
)<{ handle: string; message: string }> {}

export class SandboxHarvestHandleStore extends Context.Service<SandboxHarvestHandleStore>()(
	"SandboxHarvestHandleStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;

			const register = Effect.fn("SandboxHarvestHandleStore.register")(
				(workflowExecutionId: string, paths: ReadonlyArray<string>) =>
					Effect.gen(function* () {
						if (paths.length === 0) {
							return [];
						}

						const handles = paths.map(() => generateId());
						const fields = handles.flatMap((handle, index) => [handle, paths[index] ?? ""]);
						const key = redisKeys.sandboxHarvestHandles(workflowExecutionId);
						yield* Effect.tryPromise(() => redis.client.hset(key, ...fields));
						yield* Effect.tryPromise(() =>
							redis.client.expire(key, SANDBOX_LIMITS.harvest.handleTtlSeconds),
						);
						return handles;
					}).pipe(Effect.orDie),
			);

			const resolve = Effect.fn("SandboxHarvestHandleStore.resolve")(function* (
				workflowExecutionId: string,
				handles: ReadonlyArray<string>,
			) {
				if (handles.length === 0) {
					return [];
				}

				const paths = yield* Effect.tryPromise(() =>
					redis.client.hmget(redisKeys.sandboxHarvestHandles(workflowExecutionId), ...handles),
				).pipe(Effect.orDie);
				const missingHandle = handles.find((_, index) => paths[index] === null);
				if (missingHandle) {
					return yield* new SandboxHarvestHandleNotFoundError({
						handle: missingHandle,
						message: `Sandbox harvest handle '${missingHandle}' was not found`,
					});
				}
				return paths.map((path) => path ?? "");
			});

			const release = Effect.fn("SandboxHarvestHandleStore.release")(function* (
				workflowExecutionId: string,
			) {
				yield* redis.del(redisKeys.sandboxHarvestHandles(workflowExecutionId));
			});

			return { register, release, resolve };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
