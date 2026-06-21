#!/usr/bin/env bun

const compileCommand = [process.execPath, "run", "scripts/compile-sandbox-builtins.ts"];
export const developmentCommands = [
	[...compileCommand, "--watch", "--skip-initial"],
	[process.execPath, "run", "--watch", "src/main.ts"],
];
const compilation = Bun.spawn({
	cmd: compileCommand,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const compilationExitCode = await compilation.exited;
if (compilationExitCode !== 0) {
	process.exit(compilationExitCode);
}
const processes = developmentCommands.map((cmd) =>
	Bun.spawn({ cmd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }),
);
const stop = () => {
	for (const child of processes) {
		child.kill();
	}
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exitCode = await Promise.race(processes.map((child) => child.exited));
stop();
await Promise.allSettled(processes.map((child) => child.exited));
process.exit(exitCode);
