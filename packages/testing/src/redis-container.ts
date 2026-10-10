import { Data, Effect } from "effect";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const redisPort = 6379;

export type StartedRedisContainer = { url: string; container: StartedTestContainer };

export class RedisContainerError extends Data.TaggedError("RedisContainerError")<{
	readonly cause: unknown;
	readonly message: string;
}> {}

const containerError = (message: string, cause: unknown) =>
	new RedisContainerError({ cause, message });

export const startRedisContainerEffect = Effect.tryPromise({
	catch: (cause) => containerError("Could not start Redis container", cause),
	try: () =>
		new GenericContainer("redis:alpine")
			.withExposedPorts(redisPort)
			.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
			.start(),
}).pipe(
	Effect.map((container): StartedRedisContainer => ({
		container,
		url: `redis://${container.getHost()}:${container.getMappedPort(redisPort)}`,
	})),
);

export const stopRedisContainerEffect = (started: StartedRedisContainer) =>
	Effect.tryPromise({
		try: () => started.container.stop(),
		catch: (cause) => containerError("Could not stop Redis container", cause),
	});

export const redisGlobalSetup =
	(input: { label: string }) =>
	({ provide }: { provide: (key: "redisUrl", value: string) => void }) => {
		const running = process.env["TEST_REDIS_URL"];
		if (running) {
			provide("redisUrl", running);
			return () => Promise.resolve();
		}

		return Effect.runPromise(
			startRedisContainerEffect.pipe(
				Effect.mapError((cause) =>
					containerError(
						`Could not start Redis for the ${input.label} suite. Start a container runtime (a non-default socket needs DOCKER_HOST and TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE in the package's .env), or point TEST_REDIS_URL at a disposable Redis instance (bun run docker:up).`,
						cause,
					),
				),
				Effect.tap((redis) => Effect.sync(() => provide("redisUrl", redis.url))),
				Effect.map((redis) => () => Effect.runPromise(stopRedisContainerEffect(redis))),
			),
		);
	};
