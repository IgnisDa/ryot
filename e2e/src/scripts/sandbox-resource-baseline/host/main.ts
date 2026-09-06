import { runAppCollector } from "./app-collector";
import { type Command, parseCommand, USAGE } from "./cli";
import { appendLine, errorMessage, runCommand } from "./io";
import { boundJournal } from "./journal";
import { printMetadata, runSampler } from "./sampler";
import type { JournalLine } from "./samples";
import { runWatchdog } from "./watchdog";

const readKernelJournal = async (since: string, until: string) => {
	try {
		const result = await runCommand([
			"journalctl",
			"-k",
			"-p",
			"warning",
			"--since",
			since,
			"--until",
			until,
			"-o",
			"short-iso",
			"--no-pager",
		]);
		return {
			output: result.stdout,
			error:
				result.exitCode === 0
					? null
					: `journalctl exited ${result.exitCode}: ${result.stderr.trim()}`,
		};
	} catch (error) {
		return { output: "", error: errorMessage(error) };
	}
};

const printJournal = async (since: string, until: string) => {
	const journal = await readKernelJournal(since, until);
	appendLine(1, {
		since,
		until,
		kind: "journal",
		...boundJournal(journal.output),
		error: journal.error,
	} satisfies JournalLine);
};

let command: Command;
try {
	command = parseCommand(process.argv.slice(2));
} catch (error) {
	console.error(errorMessage(error));
	console.error(USAGE);
	process.exit(64);
}

switch (command.kind) {
	case "help":
		console.log(USAGE);
		break;
	case "sample":
		await runSampler(command);
		break;
	case "metadata":
		await printMetadata(command);
		break;
	case "app-sample":
		await runAppCollector(command);
		break;
	case "journal":
		await printJournal(command.since, command.until);
		break;
	case "watchdog":
		await runWatchdog(command);
		break;
}
