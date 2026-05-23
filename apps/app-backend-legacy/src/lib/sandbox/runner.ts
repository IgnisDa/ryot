import { dayjs } from "@ryot/ts-utils/dayjs";

import { getTemporaryDirectory, joinTemporaryDirectoryPath } from "~/lib/bun";

import sandboxRunnerSource from "./scripts/runner-source.txt";

const temporaryDirectory = getTemporaryDirectory();

export class RunnerFileManager {
	private runnerPath: string | null = null;

	async create() {
		const fileName = `ryot-sandbox-runner-${dayjs().valueOf()}-${process.pid}.mjs`;
		this.runnerPath = joinTemporaryDirectoryPath(temporaryDirectory, fileName);

		try {
			await Bun.write(this.runnerPath, sandboxRunnerSource);
		} catch (error) {
			this.runnerPath = null;
			throw new Error(
				error instanceof Error
					? `Failed to create sandbox runner: ${error.message}`
					: "Failed to create sandbox runner",
				{ cause: error },
			);
		}
	}

	async remove() {
		if (!this.runnerPath) {
			return;
		}
		try {
			await Bun.file(this.runnerPath).delete();
		} catch {}
		this.runnerPath = null;
	}

	getPath() {
		return this.runnerPath;
	}
}
