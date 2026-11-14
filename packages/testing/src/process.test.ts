import { expect } from "bun:test";

import { it } from "@voila.dev/effect-bun-test";
import { Deferred, Effect, Fiber } from "effect";

import { captureTestProcess } from "./process.js";

it.live("captures both streams and preserves the child failure", () =>
	Effect.gen(function* () {
		const result = yield* captureTestProcess({
			env: { RYOT_PROCESS_MARKER: "forwarded" },
			args: [
				"--eval",
				'console.log(process.env.RYOT_PROCESS_MARKER); console.error("diagnostic"); process.exit(7);',
			],
		});
		expect(result.exitCode).toBe(7);
		expect(result.output).toContain("forwarded");
		expect(result.output).toContain("diagnostic");
	}),
);

it.live("interrupting a workload waits for its process to exit", () =>
	Effect.gen(function* () {
		const ready = yield* Deferred.make<number>();
		const context = yield* Effect.context();
		const server = yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: 0,
					hostname: "127.0.0.1",
					fetch(request) {
						const pid = Number(new URL(request.url).pathname.slice(1));
						Effect.runSyncWith(context)(Deferred.succeed(ready, pid));
						return new Response("ready");
					},
				}),
			),
			(running) => Effect.promise(() => running.stop(true)),
		);
		const child = yield* captureTestProcess({
			args: [
				"--eval",
				`setInterval(() => {}, 1000); await fetch("http://127.0.0.1:${server.port}/" + process.pid);`,
			],
		}).pipe(Effect.forkScoped);
		const pid = yield* Deferred.await(ready);
		yield* Fiber.interrupt(child);
		expect(() => process.kill(pid, 0)).toThrow();
	}),
);
