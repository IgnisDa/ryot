import { Command, CommandExecutor } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
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
				const executor = yield* CommandExecutor.CommandExecutor;
				const restricted = makeSandboxCommandExecutor(executor, {
					PATH: "/usr/bin:/bin",
					DENO_DIR: "/tmp/ryot-sandbox-deno",
				});
				const output = yield* Command.make("/usr/bin/env").pipe(
					Command.string,
					Effect.provideService(CommandExecutor.CommandExecutor, restricted),
				);
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
	).pipe(Effect.provide(BunContext.layer));
});
