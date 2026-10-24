import { Deferred, Effect, Exit, Fiber } from "effect";

import { describe, expect, it } from "~/support/effect-test";

import { acquireCoreTestInfrastructure } from "./provisioning";
import { acquireInChildScope, makeTestResourceScope } from "./resource-scope";

const recordResource = (events: string[], name: string) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			events.push(`acquire:${name}`);
			return name;
		}),
		() =>
			Effect.sync(() => {
				events.push(`release:${name}`);
			}),
	);

const recordAcquisition = <A>(events: string[], name: string, value: A) =>
	Effect.sync(() => {
		events.push(`acquire:${name}`);
		return {
			...value,
			release: Effect.sync(() => {
				events.push(`release:${name}`);
			}),
		};
	});

const recordingInfrastructure = (events: string[], failure?: "client" | "bucket" | "cors") => {
	const configure = (stage: "bucket" | "cors") =>
		Effect.sync(() => {
			events.push(stage);
		}).pipe(Effect.andThen(stage === failure ? Effect.die(stage) : Effect.void));
	return {
		redis: recordAcquisition(events, "redis", { redisUrl: "redis" }),
		postgres: recordAcquisition(events, "postgres", {
			dbUrl: "postgres",
			pgLogPath: "retained-postgres.log",
		}),
		storage: recordAcquisition(events, "storage", {
			s3Endpoint: "storage",
			client:
				failure === "client"
					? Effect.die("client")
					: recordAcquisition(events, "client", {
							configureCors: configure("cors"),
							createBucket: configure("bucket"),
						}),
		}),
	};
};

describe("test resource ownership", () => {
	it.live(
		"keeps infrastructure until teardown and releases the API before its dependencies once",
		() =>
			Effect.gen(function* () {
				const events: string[] = [];
				const resources = makeTestResourceScope();
				const connection = yield* resources.run(
					Effect.gen(function* () {
						const acquired = yield* acquireCoreTestInfrastructure(recordingInfrastructure(events));
						yield* recordResource(events, "api");
						return acquired;
					}),
				);
				expect(connection).toEqual({
					dbUrl: "postgres",
					redisUrl: "redis",
					s3Endpoint: "storage",
					pgLogPath: "retained-postgres.log",
				});
				expect(events).toEqual([
					"acquire:postgres",
					"acquire:redis",
					"acquire:storage",
					"acquire:client",
					"bucket",
					"cors",
					"acquire:api",
				]);
				yield* resources.close;
				yield* resources.close;
				expect(events).toEqual([
					"acquire:postgres",
					"acquire:redis",
					"acquire:storage",
					"acquire:client",
					"bucket",
					"cors",
					"acquire:api",
					"release:api",
					"release:client",
					"release:storage",
					"release:redis",
					"release:postgres",
				]);
			}),
	);

	for (const stage of ["bucket", "cors"] as const) {
		it.live(`releases every acquired resource when ${stage} configuration fails`, () =>
			Effect.gen(function* () {
				const events: string[] = [];
				const result = yield* Effect.scoped(
					acquireCoreTestInfrastructure(recordingInfrastructure(events, stage)).pipe(Effect.exit),
				);
				expect(Exit.isFailure(result)).toBe(true);
				expect(events).toEqual([
					"acquire:postgres",
					"acquire:redis",
					"acquire:storage",
					"acquire:client",
					"bucket",
					...(stage === "cors" ? ["cors"] : []),
					"release:client",
					"release:storage",
					"release:redis",
					"release:postgres",
				]);
			}),
		);
	}

	it.live("releases containers when client creation fails", () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const result = yield* Effect.scoped(
				acquireCoreTestInfrastructure(recordingInfrastructure(events, "client")).pipe(Effect.exit),
			);
			expect(Exit.isFailure(result)).toBe(true);
			expect(events).toEqual([
				"acquire:postgres",
				"acquire:redis",
				"acquire:storage",
				"release:storage",
				"release:redis",
				"release:postgres",
			]);
		}),
	);

	it.live("owns a late sibling acquisition after another resource fails", () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const started = yield* Deferred.make<void>();
			const failed = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			const resources = makeTestResourceScope();
			const acquisition = resources.run(
				acquireCoreTestInfrastructure({
					...recordingInfrastructure(events),
					storage: Effect.gen(function* () {
						yield* Deferred.await(started);
						yield* Deferred.succeed(failed, undefined);
						return yield* Effect.die("storage startup");
					}),
					redis: Effect.gen(function* () {
						yield* Deferred.succeed(started, undefined);
						yield* Deferred.await(finish);
						events.push("acquire:redis");
						return {
							redisUrl: "redis",
							release: Effect.sync(() => {
								events.push("release:redis");
							}),
						};
					}),
				}),
			);
			const fiber = yield* Effect.forkChild(acquisition.pipe(Effect.exit));
			yield* Deferred.await(failed);
			expect(events).toEqual(["acquire:postgres"]);
			yield* Deferred.succeed(finish, undefined);
			expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true);
			yield* resources.close;
			expect(events).toEqual([
				"acquire:postgres",
				"acquire:redis",
				"release:redis",
				"release:postgres",
			]);
		}),
	);

	it.live("releases a resource acquired after interruption without publishing it", () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const started = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			const resources = makeTestResourceScope();
			const fiber = yield* Effect.forkChild(
				resources.run(
					Effect.gen(function* () {
						yield* recordResource(events, "postgres");
						yield* Effect.acquireRelease(
							Effect.gen(function* () {
								yield* Deferred.succeed(started, undefined);
								yield* Deferred.await(finish);
								events.push("acquire:api");
							}),
							() =>
								Effect.sync(() => {
									events.push("release:api");
								}),
						);
						events.push("published");
					}),
				),
			);
			yield* Deferred.await(started);
			const interruption = yield* Effect.forkChild(Fiber.interrupt(fiber));
			yield* Effect.yieldNow;
			yield* Deferred.succeed(finish, undefined);
			yield* Fiber.join(interruption);
			yield* resources.close;
			expect(events).toEqual([
				"acquire:postgres",
				"acquire:api",
				"release:api",
				"release:postgres",
			]);
		}),
	);

	it.live("closes a failed child acquisition promptly while its parent stays open", () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const resources = makeTestResourceScope();
			yield* resources.run(
				Effect.gen(function* () {
					yield* recordResource(events, "infrastructure");
					const result = yield* Effect.gen(function* () {
						yield* recordResource(events, "api");
						return yield* Effect.die("health check");
					}).pipe(acquireInChildScope, Effect.exit);
					expect(Exit.isFailure(result)).toBe(true);
					expect(events).toEqual(["acquire:infrastructure", "acquire:api", "release:api"]);
				}),
			);
			yield* resources.close;
			expect(events).toEqual([
				"acquire:infrastructure",
				"acquire:api",
				"release:api",
				"release:infrastructure",
			]);
		}),
	);

	it.live("runs remaining finalizers after a strict release failure", () =>
		Effect.gen(function* () {
			const events: string[] = [];
			const resources = makeTestResourceScope();
			yield* resources.run(
				Effect.gen(function* () {
					yield* recordResource(events, "infrastructure");
					yield* Effect.acquireRelease(Effect.void, () =>
						Effect.sync(() => {
							events.push("release:api");
						}).pipe(Effect.andThen(Effect.die("strict cleanup"))),
					);
				}),
			);
			expect(Exit.isFailure(yield* Effect.exit(resources.close))).toBe(true);
			expect(events).toEqual(["acquire:infrastructure", "release:api", "release:infrastructure"]);
		}),
	);
});
