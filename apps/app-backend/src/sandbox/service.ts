import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { generateId } from "better-auth";
import { BridgeServer } from "./bridge";
import { defaultMaxHeapMB, defaultTimeoutMs } from "./constants";
import { httpCall } from "./host-functions";
import {
	type SandboxRunJobData,
	sandboxRunJobName,
	sandboxRunJobResult,
	sandboxRunJobWaitTimeoutMs,
} from "./jobs";
import { RunnerFileManager } from "./runner";
import type { ApiFunction, SandboxResult, SandboxRunOptions } from "./types";
import {
	attachTimeoutGuard,
	formatExit,
	readStream,
	waitForExit,
} from "./utils";

export class SandboxService {
	private readonly bridgeServer = new BridgeServer();
	private readonly runnerManager = new RunnerFileManager();
	private readonly queuedApiFunctions = new Map<
		string,
		Record<string, ApiFunction>
	>();

	async start() {
		await this.bridgeServer.start();
		await this.runnerManager.create();
	}

	async stop() {
		this.queuedApiFunctions.clear();
		await this.bridgeServer.clearSessions();
		await this.bridgeServer.stop();
		await this.runnerManager.remove();
	}

	async run(options: SandboxRunOptions) {
		const apiFunctionsId = this.setQueuedApiFunctions(options.apiFunctions);

		try {
			const queues = await this.getQueues();
			const waitTimeoutMs = Math.max(
				sandboxRunJobWaitTimeoutMs,
				(options.timeoutMs ?? defaultTimeoutMs) + 5_000,
			);

			const job = await queues.sandboxScriptQueue.add(sandboxRunJobName, {
				apiFunctionsId,
				code: options.code,
				userId: options.userId,
				context: options.context,
				timeoutMs: options.timeoutMs,
				maxHeapMB: options.maxHeapMB,
			});

			if (!job.id)
				return {
					success: false,
					error: "Could not create sandbox run job",
				};

			const result = await job.waitUntilFinished(
				queues.sandboxScriptQueueEvents,
				waitTimeoutMs,
			);

			const parsedResult = sandboxRunJobResult.safeParse(result);
			if (!parsedResult.success)
				return {
					success: false,
					error: "Sandbox job returned invalid payload",
				};

			return parsedResult.data;
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.toLowerCase().includes("timed out")
			)
				return {
					success: false,
					error: "Sandbox job timed out",
				};

			return {
				success: false,
				error: error instanceof Error ? error.message : "Sandbox job failed",
			};
		} finally {
			if (apiFunctionsId) this.queuedApiFunctions.delete(apiFunctionsId);
		}
	}

	async executeQueuedRun(jobData: SandboxRunJobData) {
		const apiFunctions = this.consumeQueuedApiFunctions(jobData.apiFunctionsId);

		return this.execute({
			apiFunctions,
			code: jobData.code,
			userId: jobData.userId,
			context: jobData.context,
			timeoutMs: jobData.timeoutMs,
			maxHeapMB: jobData.maxHeapMB,
		});
	}

	async execute(options: SandboxRunOptions) {
		const bridgePort = this.bridgeServer.getPort();
		const runnerPath = this.runnerManager.getPath();

		if (!bridgePort || !runnerPath)
			throw new Error("Sandbox service is not initialized");

		const context = options.context ?? {};
		const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
		const maxHeapMB = options.maxHeapMB ?? defaultMaxHeapMB;
		const apiFunctions = {
			httpCall,
			...(options.apiFunctions ?? {}),
		};

		const executionId = generateId();
		const token = randomBytes(32).toString("hex");

		await this.bridgeServer.addSession(executionId, {
			token,
			apiFunctions,
			userId: options.userId,
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
				"--no-remote",
				"--no-npm",
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

			if (timedOut)
				return {
					logs,
					success: false,
					error: `Sandbox timed out after ${timeoutMs}ms`,
				};

			try {
				const parsed = JSON.parse(resultText) as SandboxResult;

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
						exit.signal === "SIGTERM" || exit.signal === "SIGKILL"
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

	private consumeQueuedApiFunctions(apiFunctionsId?: string) {
		if (!apiFunctionsId) return undefined;

		const apiFunctions = this.queuedApiFunctions.get(apiFunctionsId);
		this.queuedApiFunctions.delete(apiFunctionsId);
		if (!apiFunctions)
			throw new Error("Sandbox run API functions are unavailable");

		return apiFunctions;
	}

	private async getQueues() {
		const { getQueues } = await import("../queue");
		return getQueues();
	}

	private setQueuedApiFunctions(apiFunctions?: Record<string, ApiFunction>) {
		if (!apiFunctions || Object.keys(apiFunctions).length === 0)
			return undefined;

		const apiFunctionsId = generateId();
		this.queuedApiFunctions.set(apiFunctionsId, apiFunctions);
		return apiFunctionsId;
	}
}
