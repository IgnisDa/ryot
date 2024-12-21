import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { generateId } from "better-auth";
import { BridgeServer } from "./bridge";
import { defaultMaxHeapMB, defaultTimeoutMs } from "./constants";
import { RunnerFileManager } from "./runner";
import type { SandboxResult, SandboxRunOptions } from "./types";
import {
	attachTimeoutGuard,
	formatExit,
	readStream,
	waitForExit,
} from "./utils";

export class SandboxService {
	private readonly bridgeServer = new BridgeServer();
	private readonly runnerManager = new RunnerFileManager();

	async start() {
		await this.bridgeServer.start();
		await this.runnerManager.create();
	}

	async stop() {
		await this.bridgeServer.clearSessions();
		await this.bridgeServer.stop();
		await this.runnerManager.remove();
	}

	async run(options: SandboxRunOptions): Promise<SandboxResult> {
		const bridgePort = this.bridgeServer.getPort();
		const runnerPath = this.runnerManager.getPath();

		if (!bridgePort || !runnerPath)
			throw new Error("Sandbox service is not initialized");

		const context = options.context ?? {};
		const apiFunctions = options.apiFunctions ?? {};
		const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
		const maxHeapMB = options.maxHeapMB ?? defaultMaxHeapMB;

		const executionId = generateId();
		const token = randomBytes(32).toString("hex");

		await this.bridgeServer.addSession(executionId, {
			token,
			apiFunctions,
			expiresAt: Date.now() + timeoutMs + 2000,
		});

		try {
			let timedOut = false;

			const denoArgs = [
				"run",
				"--deny-run",
				"--deny-env",
				"--deny-ffi",
				"--no-prompt",
				"--deny-write",
				`--allow-read=${runnerPath}`,
				`--allow-net=127.0.0.1:${bridgePort}`,
				`--v8-flags=--max-heap-size=${maxHeapMB}`,
				runnerPath,
			];

			const proc = spawn("deno", denoArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: { PATH: process.env.PATH },
			});

			const clearTimeoutGuard = attachTimeoutGuard(proc, timeoutMs, () => {
				timedOut = true;
			});

			const payload = JSON.stringify({
				token,
				context,
				executionId,
				code: options.code,
				apiBase: `http://127.0.0.1:${bridgePort}`,
				apiFunctions: Object.keys(apiFunctions),
			});

			try {
				proc.stdin.write(payload);
				proc.stdin.end();
			} catch {
				clearTimeoutGuard();
				return {
					success: false,
					error: "Failed to send payload to sandbox",
				};
			}

			const [exit, stderrText, stdoutText] = await Promise.all([
				waitForExit(proc),
				readStream(proc.stderr),
				readStream(proc.stdout),
			]).finally(() => clearTimeoutGuard());

			const logs = stderrText.trim() || undefined;
			const resultText = stdoutText.trim();

			try {
				const parsed = JSON.parse(resultText) as SandboxResult;

				if (timedOut)
					return {
						logs,
						success: false,
						error: `Sandbox timed out after ${timeoutMs}ms`,
					};

				return {
					logs,
					value: parsed.value,
					error: parsed.error,
					success: Boolean(parsed.success),
				};
			} catch {
				return {
					logs,
					success: false,
					error:
						timedOut || exit.signal === "SIGTERM" || exit.signal === "SIGKILL"
							? `Sandbox timed out after ${timeoutMs}ms`
							: resultText || formatExit(exit),
				};
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			await this.bridgeServer.removeSession(executionId);
		}
	}
}
