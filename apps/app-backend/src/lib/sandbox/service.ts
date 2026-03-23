import { generateId } from "better-auth";
import { getQueues } from "../queue";
import { BridgeServer } from "./bridge";
import { defaultMaxHeapMB, defaultTimeoutMs } from "./constants";
import { hostFunctionRegistry } from "./function-registry";
import { type SandboxRunJobData, sandboxRunJobName } from "./jobs";
import { RunnerFileManager } from "./runner";
import type {
	ApiFunction,
	HostFunctionFactory,
	SandboxEnqueueOptions,
	SandboxResult,
	SandboxRunOptions,
} from "./types";
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

	async run(options: SandboxRunOptions) {
		return this.execute(options);
	}

	async enqueue(options: SandboxEnqueueOptions) {
		const jobId = generateId();
		const queues = getQueues();

		await queues.sandboxScriptQueue.add(
			sandboxRunJobName,
			{
				code: options.code,
				userId: options.userId,
				context: options.context,
				apiFunctionDescriptors: options.apiFunctionDescriptors,
			},
			{ jobId },
		);

		return { jobId };
	}

	async executeQueuedRun(jobData: SandboxRunJobData) {
		const descriptors = jobData.apiFunctionDescriptors;
		const apiFunctions = descriptors?.length
			? this.resolveApiFunctions(descriptors)
			: undefined;

		return this.execute({
			apiFunctions,
			code: jobData.code,
			userId: jobData.userId,
			context: jobData.context,
			timeoutMs: jobData.timeoutMs,
			maxHeapMB: jobData.maxHeapMB,
		});
	}

	private async execute(options: SandboxRunOptions) {
		const bridgePort = this.bridgeServer.getPort();
		const runnerPath = this.runnerManager.getPath();

		if (!bridgePort || !runnerPath) {
			throw new Error("Sandbox service is not initialized");
		}

		const context = options.context ?? {};
		const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
		const maxHeapMB = options.maxHeapMB ?? defaultMaxHeapMB;
		const apiFunctions = { ...(options.apiFunctions ?? {}) };

		const token = generateId();
		const executionId = generateId();

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

			const proc = Bun.spawn(["deno", ...denoArgs], {
				stdin: "pipe",
				stderr: "pipe",
				stdout: "pipe",
				env: { PATH: process.env.PATH },
			});

			if (!proc.stdin) {
				return {
					success: false,
					error: "Sandbox stdin is unavailable",
				};
			}

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
				proc.kill("SIGKILL");
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

			if (timedOut) {
				return {
					logs,
					success: false,
					error: `Sandbox timed out after ${timeoutMs}ms`,
				};
			}

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

	private resolveApiFunctions(
		descriptors: SandboxRunJobData["apiFunctionDescriptors"],
	) {
		const apiFunctions: Record<string, ApiFunction> = {};
		const registry = hostFunctionRegistry as Record<
			string,
			HostFunctionFactory
		>;

		for (const descriptor of descriptors ?? []) {
			const factory = registry[descriptor.functionKey];
			if (!factory) {
				throw new Error(
					`Unknown sandbox host function: ${descriptor.functionKey}`,
				);
			}

			apiFunctions[descriptor.functionKey] = factory(descriptor.context);
		}

		return apiFunctions;
	}
}
