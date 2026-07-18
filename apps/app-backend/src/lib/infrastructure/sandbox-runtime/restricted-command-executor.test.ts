import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, it } from "vitest";

import { makeSandboxCommandExecutor } from "./restricted-command-executor";

it("passes only the explicit sandbox environment allowlist to child processes", () => {
	const sentinel = "RYOT_SANDBOX_AMBIENT_SENTINEL";
	const previous = Bun.env[sentinel];
	return Effect.acquireUseRelease(
		Effect.sync(() => {
			Bun.env[sentinel] = "must-not-reach-child";
		}),
		() =>
			Effect.gen(function* () {
				const executor = yield* ChildProcessSpawner.ChildProcessSpawner;
				const restricted = makeSandboxCommandExecutor(executor, {
					PATH: "/usr/bin:/bin",
					DENO_DIR: "/tmp/ryot-sandbox-deno",
				});
				const output = yield* restricted.string(ChildProcess.make("/usr/bin/env"));
				expect(output.trim().split("\n").sort()).toEqual([
					"DENO_DIR=/tmp/ryot-sandbox-deno",
					"PATH=/usr/bin:/bin",
				]);
			}),
		() =>
			Effect.sync(() => {
				if (previous === undefined) {
					delete Bun.env[sentinel];
				} else {
					Bun.env[sentinel] = previous;
				}
			}),
	).pipe(Effect.provide(BunServices.layer));
});
