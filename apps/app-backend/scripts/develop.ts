#!/usr/bin/env bun

export const developmentCommands = [
	[process.execPath, "run", "scripts/compile-sandbox-builtins.ts", "--watch", "--skip-initial"],
	[process.execPath, "run", "--watch", "src/main.ts"],
];
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
