import { Command, CommandExecutor } from "@effect/platform";
import { Option } from "effect";

export type SandboxCommandEnvironment = Readonly<{
	PATH: string;
	DENO_DIR: string;
}>;

// TODO: https://github.com/Effect-TS/effect/issues/6643
// Remove this env wrapper when Effect supports commands that do not inherit the parent environment.
const restrictCommandEnvironment = (
	command: Command.Command,
	environment: SandboxCommandEnvironment,
): Command.Command => {
	if (command._tag === "PipedCommand") {
		return Command.pipeTo(
			restrictCommandEnvironment(command.left, environment),
			restrictCommandEnvironment(command.right, environment),
		);
	}

	const restricted = Command.make(
		"/usr/bin/env",
		"-i",
		`PATH=${environment.PATH}`,
		`DENO_DIR=${environment.DENO_DIR}`,
		command.command,
		...command.args,
	).pipe(
		Command.stdin(command.stdin),
		Command.stdout(command.stdout),
		Command.stderr(command.stderr),
		Command.runInShell(command.shell),
	);
	return Option.match(command.cwd, {
		onNone: () => restricted,
		onSome: (cwd) => Command.workingDirectory(restricted, cwd),
	});
};

export const makeSandboxCommandExecutor = (
	executor: CommandExecutor.CommandExecutor,
	environment: SandboxCommandEnvironment,
) =>
	CommandExecutor.makeExecutor((command) =>
		executor.start(restrictCommandEnvironment(command, environment)),
	);
