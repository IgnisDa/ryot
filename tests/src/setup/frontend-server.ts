import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import getPort from "get-port";

export async function withFrontendService<T>(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	callback: (url: string) => Promise<T>,
) {
	const port = await getPort();
	const url = `http://127.0.0.1:${port}`;
	const child = spawn(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		cwd: path.resolve(__dirname, "../../../apps/frontend"),
		env: {
			...process.env,
			...env,
			HOST: "127.0.0.1",
			PORT: port.toString(),
		},
	});
	let output = "";
	let processError: Error | undefined;
	child.on("error", (error) => {
		processError = error;
	});
	for (const stream of [child.stdout, child.stderr]) {
		stream?.on("data", (chunk: Buffer) => {
			output = `${output}${chunk.toString()}`.slice(-4000);
		});
	}
	const exited = new Promise<void>((resolve) =>
		child.once("close", () => resolve()),
	);
	try {
		const timeoutAt = Date.now() + 15000;
		while (Date.now() < timeoutAt) {
			if (processError) throw processError;
			if (child.exitCode !== null || child.signalCode !== null) break;
			let ready = false;
			try {
				const response = await fetch(`${url}/actions`, {
					redirect: "manual",
					signal: AbortSignal.timeout(1000),
				});
				ready = response.status === 302;
				await response.body?.cancel();
			} catch {}
			if (ready) return await callback(url);
			await delay(100);
		}
		throw new Error(`Frontend test service did not become ready: ${output}`);
	} finally {
		if (child.pid && child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			const stopped = await Promise.race([
				exited.then(() => true),
				delay(5000, false, { ref: false }),
			]);
			if (!stopped) {
				child.kill("SIGKILL");
				await exited;
			}
		}
	}
}
