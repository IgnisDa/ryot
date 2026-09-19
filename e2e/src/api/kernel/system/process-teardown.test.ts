import { Effect } from "effect";

import { describe, expect, it } from "~/support/effect-test";
import { stopApiProcess } from "~/support/provisioning";

const startChild = (signalHandler: string) =>
	Effect.gen(function* () {
		const child = yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.spawn(
					[
						"bun",
						"--eval",
						`process.on("SIGINT", ${signalHandler}); process.stdout.write("ready"); setInterval(() => {}, 1000);`,
					],
					{ stdout: "pipe", stdin: "ignore", stderr: "ignore" },
				),
			),
			(proc) =>
				Effect.gen(function* () {
					if (proc.exitCode === null) {
						proc.kill("SIGKILL");
					}
					yield* Effect.promise(() => proc.exited);
				}),
		);
		yield* Effect.acquireUseRelease(
			Effect.sync(() => child.stdout.getReader()),
			(reader) => Effect.promise(() => reader.read()),
			(reader) => Effect.sync(() => reader.releaseLock()),
		);
		return child;
	});

describe("tracked API child teardown", () => {
	it.live("allows a child to exit through its SIGINT handler", () =>
		Effect.gen(function* () {
			const child = yield* startChild("() => process.exit(23)");
			yield* stopApiProcess(child);

			expect(child.exitCode).toBe(23);
			expect(yield* Effect.promise(() => child.exited)).toBe(23);
		}),
	);

	it.live("kills and reaps a still-running child after an earlier ignored SIGINT", () =>
		Effect.gen(function* () {
			const child = yield* startChild("() => {}");
			const otherChild = yield* startChild("() => {}");
			child.kill("SIGINT");
			yield* stopApiProcess(child);

			expect(child.signalCode).toBe("SIGKILL");
			expect(() => process.kill(child.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
			expect(otherChild.exitCode).toBeNull();
		}),
	);
});
