import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, Option, Result, Runtime, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { AppConfig, configError } from "./config/service";
import { MiB } from "./sandbox-runtime/limits";
import { sharedModeMinimumBudgetBytes } from "./sandbox-runtime/sidecar-admission";

const roles = ["interactive", "background"] as const satisfies ReadonlyArray<ExecutionLane>;
const backgroundNiceness = "19";
const roleShutdownGrace = "30 seconds";
const minimumRoleBudgetMiB = Math.ceil(sharedModeMinimumBudgetBytes / MiB);

export class SplitSupervisorError extends Schema.TaggedError<SplitSupervisorError>()(
	"SplitSupervisorError",
	{ exitCode: Schema.Int, message: Schema.String },
) {
	override get [Runtime.errorExitCode]() {
		return this.exitCode;
	}
}

/** The command that starts this program again; every supervised process runs it. */
export type SplitEntry = { readonly executable: string; readonly args: ReadonlyArray<string> };

export const splitMemoryBudget = (
	configuredMiB: Option.Option<number>,
	effectiveMemory: number,
) => {
	if (!Number.isSafeInteger(effectiveMemory) || effectiveMemory <= 0) {
		return Result.fail(configError("Sandbox effective host memory is unavailable."));
	}
	const halfMemoryMiB = Math.floor(Math.floor(effectiveMemory / 2) / MiB);
	const totalMiB = Option.getOrElse(configuredMiB, () => halfMemoryMiB);
	if (totalMiB > halfMemoryMiB) {
		return Result.fail(
			configError(
				`SANDBOX_MEMORY_BUDGET_MIB (${totalMiB}) exceeds half the effective host memory (${halfMemoryMiB} MiB).`,
			),
		);
	}
	const roleMiB = Math.floor(totalMiB / 2);
	if (roleMiB < minimumRoleBudgetMiB) {
		return Result.fail(
			configError(
				`SERVER_LANES=split divides the sandbox memory budget between two roles and needs a total of at least ${2 * minimumRoleBudgetMiB} MiB, which is ${4 * minimumRoleBudgetMiB} MiB of effective memory by default; the budget is ${totalMiB} MiB.`,
			),
		);
	}
	return Result.succeed({ roleMiB, totalMiB });
};

const inherited = { stdin: "ignore", stdout: "inherit", stderr: "inherit" } as const;

export const migrationCommand = (entry: SplitEntry) =>
	ChildProcess.make(entry.executable, entry.args, {
		...inherited,
		extendEnv: true,
		env: { SERVER_LANES: "all", RUN_MIGRATION_ONLY: "true", SERVER_RUNNER_SOCKET_DIR: undefined },
	});

export const roleCommand = (entry: SplitEntry, role: ExecutionLane, roleMiB: number) =>
	ChildProcess.make(
		role === "background" ? "nice" : entry.executable,
		role === "background"
			? ["-n", backgroundNiceness, entry.executable, ...entry.args]
			: entry.args,
		{
			...inherited,
			extendEnv: true,
			killSignal: "SIGTERM",
			forceKillAfter: roleShutdownGrace,
			env: { SERVER_LANES: role, SANDBOX_MEMORY_BUDGET_MIB: String(roleMiB) },
		},
	);

export const runSplitSupervisor = Effect.fn("runSplitSupervisor")(function* (input: {
	readonly entry: SplitEntry;
	readonly effectiveMemory: number;
}) {
	const config = yield* AppConfig;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const budget = yield* Effect.fromResult(
		splitMemoryBudget(config.sandbox.memoryBudgetMiB, input.effectiveMemory),
	);
	yield* spawner.exitCode(migrationCommand(input.entry)).pipe(
		Effect.mapError(
			(error) =>
				new SplitSupervisorError({
					exitCode: 1,
					message: `Migration process failed: ${error.message}`,
				}),
		),
		Effect.filterOrFail(
			(exitCode) => exitCode === 0,
			(exitCode) =>
				new SplitSupervisorError({
					exitCode,
					message: `Migration process exited with code ${exitCode}`,
				}),
		),
	);
	yield* Effect.logInfo("Split supervisor starting roles").pipe(
		Effect.annotateLogs({ roleBudgetMiB: budget.roleMiB, totalBudgetMiB: budget.totalMiB }),
	);

	const handles = yield* Effect.forEach(roles, (role) =>
		spawner.spawn(roleCommand(input.entry, role, budget.roleMiB)),
	);
	yield* Effect.addFinalizer(() =>
		Effect.forEach(handles, (handle) => handle.kill({ forceKillAfter: roleShutdownGrace }), {
			concurrency: "unbounded",
		}).pipe(Effect.ignore),
	);
	const exits = handles.map((handle, index) =>
		handle.exitCode.pipe(
			Effect.map((exitCode) => ({ exitCode, role: roles[index] })),
			Effect.mapError(
				(error) =>
					new SplitSupervisorError({
						exitCode: 1,
						message: `The ${roles[index]} role stopped: ${error.message}`,
					}),
			),
		),
	);
	yield* Effect.raceAllFirst(exits).pipe(
		Effect.filterOrFail(
			({ exitCode }) => exitCode === 0,
			({ role, exitCode }) =>
				new SplitSupervisorError({
					exitCode,
					message: `The ${role} role exited with code ${exitCode}`,
				}),
		),
	);
});
