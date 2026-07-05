import { join, resolve } from "node:path";

import { getTransform } from "./registry";
import { discoverSourceFiles, REPOSITORY_ROOT, SOURCE_EXTENSIONS, toRepositoryPath } from "./scope";

export type RunnerMode = "dry-run" | "write";

export type RunnerOptions = {
	mode: RunnerMode;
	paths: string[];
	transform: ReturnType<typeof getTransform>;
};

const USAGE = "Usage: bun effect-v4:codemod <transform> (--dry-run | --write) [paths...]";

const argumentError = (message: string) => new Error(`${message}\n${USAGE}`);

export const parseRunnerArgs = (args: readonly string[]): RunnerOptions => {
	let mode: RunnerMode | undefined;
	const positional: string[] = [];

	for (const argument of args) {
		if (argument === "--dry-run" || argument === "--write") {
			if (mode)
				throw argumentError("Exactly one mode is required; modes cannot be combined or repeated.");
			mode = argument === "--dry-run" ? "dry-run" : "write";
		} else if (argument.startsWith("-")) {
			throw argumentError(`Unknown option: ${argument}`);
		} else {
			positional.push(argument);
		}
	}

	if (!mode) throw argumentError("Exactly one mode is required: --dry-run or --write.");

	const [name, ...paths] = positional;
	if (!name) throw argumentError("A registered transform name is required.");

	return { mode, paths, transform: getTransform(name) };
};

export const buildJscodeshiftCommand = (
	options: RunnerOptions,
	targets: readonly string[],
	rootDir = REPOSITORY_ROOT,
) => {
	const command = [
		join(resolve(rootDir), "node_modules", ".bin", "jscodeshift"),
		`--transform=${options.transform.path}`,
		"--parser=tsx",
		`--extensions=${SOURCE_EXTENSIONS.map((extension) => extension.slice(1)).join(",")}`,
		"--fail-on-error",
	];
	if (options.mode === "dry-run") command.push("--dry");
	command.push(...targets.map((target) => toRepositoryPath(rootDir, target)));
	return command;
};

export const prepareRunner = async (args: readonly string[], rootDir = REPOSITORY_ROOT) => {
	const root = resolve(rootDir);
	const options = parseRunnerArgs(args);
	const targets = await discoverSourceFiles(root, options.paths);
	if (!targets.length) throw new Error("No in-scope TypeScript source files discovered.");

	return {
		...options,
		targets,
		command: buildJscodeshiftCommand(options, targets, root),
	};
};

export const runRunner = async (args: readonly string[], rootDir = REPOSITORY_ROOT) => {
	const prepared = await prepareRunner(args, rootDir);
	console.log(`Mode: ${prepared.mode}`);
	console.log(`Transform: ${prepared.transform.name}`);
	console.log(`Target count: ${prepared.targets.length}`);

	const process = Bun.spawn(prepared.command, {
		cwd: resolve(rootDir),
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return process.exited;
};

if (import.meta.main) {
	try {
		process.exitCode = await runRunner(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
