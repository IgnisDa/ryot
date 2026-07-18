import { Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export type SandboxCommandEnvironment = Readonly<{
	PATH: string;
	DENO_DIR: string;
}>;

// TODO: https://github.com/Effect-TS/effect/issues/6643
// Remove this env wrapper when Effect supports commands that do not inherit the parent environment.
const restrictCommandEnvironment = (
	command: ChildProcess.Command,
	environment: SandboxCommandEnvironment,
): ChildProcess.Command => {
	if (command._tag === "PipedCommand") {
		return ChildProcess.pipeTo(
			restrictCommandEnvironment(command.left, environment),
			restrictCommandEnvironment(command.right, environment),
		);
	}

	const restricted = ChildProcess.make(
		"/usr/bin/env",
		[
			"-i",
			`PATH=${environment.PATH}`,
			`DENO_DIR=${environment.DENO_DIR}`,
			command.command,
			...command.args,
		],
		command.options,
	);
	return Option.match(Option.fromNullishOr(command.options.cwd), {
		onNone: () => restricted,
		onSome: (cwd) => ChildProcess.setCwd(restricted, cwd),
	});
};

export const makeSandboxCommandExecutor = (
	executor: ChildProcessSpawner.ChildProcessSpawner["Service"],
	environment: SandboxCommandEnvironment,
) =>
	ChildProcessSpawner.make((command) =>
		executor.spawn(restrictCommandEnvironment(command, environment)),
	);
