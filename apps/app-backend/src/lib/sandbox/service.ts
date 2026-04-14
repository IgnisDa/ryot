import { dayjs } from "@ryot/ts-utils";
import { generateId } from "better-auth";
import { type Job, Worker } from "bullmq";
import { getQueues } from "../queue";
import { getRedisConnection } from "../queue/connection";
import { onWorkerError } from "../queue/utils";
import { BridgeServer } from "./bridge";
import {
	defaultMaxHeapMB,
	defaultTimeoutMs,
	vendoredPackages,
} from "./constants";
import {
	buildApiFunctionDescriptors,
	hostFunctionRegistry,
} from "./function-registry";
import {
	type SandboxRunJobData,
	sandboxRunJobData,
	sandboxRunJobName,
} from "./jobs";
import { PackageCacheManager } from "./package-cache";
import { getSandboxScriptById } from "./repository";
import { RunnerFileManager } from "./runner";
import type {
	ApiFunctionDescriptor,
	HostFunctionFactory,
	SandboxEnqueueOptions,
	SandboxResult,
} from "./types";
import { sandboxScriptMetadataSchema } from "./types";
import {
	attachTimeoutGuard,
	formatExit,
	readStream,
	waitForExit,
} from "./utils";

export class SandboxService {
	private readonly bridgeServer = new BridgeServer();
	private readonly runnerManager = new RunnerFileManager();
	private readonly packageCache = new PackageCacheManager();

	private readonly executionDefaults = {
		maxHeapMB: defaultMaxHeapMB,
		timeoutMs: defaultTimeoutMs,
	};

	async start() {
		await this.bridgeServer.start();
		await this.runnerManager.create();
		await this.packageCache.populate(vendoredPackages);
	}

	async stop() {
		await this.bridgeServer.clearSessions();
		await this.bridgeServer.stop();
		await this.runnerManager.remove();
	}

	async enqueue(options: SandboxEnqueueOptions) {
		const jobId = generateId();

		await this.getQueue().add(
			sandboxRunJobName,
			{
				userId: options.userId,
				context: options.context,
				scriptId: options.scriptId,
				driverName: options.driverName,
			},
			{ jobId },
		);

		return { jobId };
	}

	async getJobByIdForUser(input: {
		jobId: string;
		userId: string;
	}): Promise<SandboxJobLookupResult | null> {
		const job = await this.getQueue().getJob(input.jobId);
		if (!job) {
			return null;
		}

		const jobData = sandboxRunJobData.safeParse(job.data);
		if (!jobData.success || jobData.data.userId !== input.userId) {
			return null;
		}

		return { job, jobData: jobData.data };
	}

	createWorker() {
		const worker = new Worker("sandbox", async (job) => this.processJob(job), {
			concurrency: 5,
			connection: getRedisConnection(),
		});
		worker.on("error", onWorkerError("sandbox"));
		return worker;
	}

	private async processJob(job: Job) {
		if (job.name === sandboxRunJobName) {
			return this.processSandboxRunJob(job);
		}

		throw new Error(`Unsupported sandbox job: ${job.name}`);
	}

	private async processSandboxRunJob(job: Job) {
		const parsed = sandboxRunJobData.safeParse(job.data);
		if (!parsed.success) {
			throw new Error("Sandbox run payload is invalid");
		}

		return this.executeQueuedRun(parsed.data);
	}

	private async executeQueuedRun(
		jobData: SandboxRunJobData,
		scriptFetcher: typeof getSandboxScriptById = getSandboxScriptById,
	): Promise<QueuedRunResult> {
		const script = await scriptFetcher(jobData.scriptId);
		if (!script) {
			return { success: false, error: "Sandbox script not found" };
		}

		const metadata = sandboxScriptMetadataSchema.safeParse(script.metadata);
		const allowedKeys = metadata.success
			? (metadata.data.allowedHostFunctions ??
				Object.keys(hostFunctionRegistry))
			: Object.keys(hostFunctionRegistry);

		const descriptors = buildApiFunctionDescriptors(
			allowedKeys,
			jobData.userId,
			jobData.scriptId,
		);

		return this.execute({
			code: script.code,
			context: jobData.context,
			scriptId: jobData.scriptId,
			timeoutMs: jobData.timeoutMs,
			maxHeapMB: jobData.maxHeapMB,
			driverName: jobData.driverName,
			apiFunctions: this.resolveApiFunctions(descriptors),
		});
	}

	private async execute(options: SandboxExecutionOptions) {
		const bridgePort = this.bridgeServer.getPort();
		const runnerPath = this.runnerManager.getPath();

		if (!bridgePort || !runnerPath) {
			throw new Error("Sandbox service is not initialized");
		}

		const context = options.context ?? {};
		const timeoutMs = options.timeoutMs ?? this.executionDefaults.timeoutMs;
		const maxHeapMB = options.maxHeapMB ?? this.executionDefaults.maxHeapMB;
		const apiFunctions = { ...(options.apiFunctions ?? {}) };

		const token = generateId();
		const executionId = generateId();

		await this.bridgeServer.addSession(executionId, {
			token,
			apiFunctions,
			expiresAt: dayjs()
				.add(timeoutMs + 2000, "millisecond")
				.valueOf(),
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
				"--cached-only",
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
				env: { DENO_DIR: this.packageCache.getDir(), PATH: process.env.PATH },
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
				scriptId: options.scriptId,
				driverName: options.driverName,
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

	private resolveApiFunctions(descriptors: ApiFunctionDescriptor[]) {
		const apiFunctions: SandboxExecutionOptions["apiFunctions"] = {};
		const registry = hostFunctionRegistry as Record<
			string,
			HostFunctionFactory
		>;

		for (const descriptor of descriptors) {
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

	private getQueue() {
		return getQueues().sandboxQueue;
	}
}

type SandboxExecutionOptions = Pick<
	SandboxRunJobData,
	"context" | "maxHeapMB" | "timeoutMs" | "driverName" | "scriptId"
> & {
	code: string;
	apiFunctions?: Record<string, (...args: Array<unknown>) => Promise<unknown>>;
};

export type QueuedRunResult = {
	value?: unknown;
	success: boolean;
	logs?: string | null;
	error?: string | null;
};

type SandboxJobLookupResult = {
	jobData: SandboxRunJobData;
	job: {
		data: unknown;
		returnvalue: unknown;
		failedReason?: string;
		getState: Job["getState"];
	};
};
