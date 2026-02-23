import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateId } from "better-auth";
import sandboxRunnerSource from "./runner-source.txt";
import type { ApiFunction, SandboxResult, SandboxRunOptions } from "./types";

const defaultMaxHeapMB = 64;
const forceKillDelayMs = 500;
const defaultTimeoutMs = 10_000;
const requestBodyLimit = 128_000;

type ProcessExit = {
	code: number | null;
	signal: NodeJS.Signals | null;
};

interface ExecutionSession {
	token: string;
	expiresAt: number;
	apiFunctions: Record<string, ApiFunction>;
}

const sendJson = (
	res: ServerResponse,
	status: number,
	payload: Record<string, unknown>,
) => {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
};

export class SandboxService {
	private runnerPath: string | null = null;
	private bridgePort: number | null = null;
	private bridgeServer: Server | null = null;
	private readonly sessions = new Map<string, ExecutionSession>();

	async start() {
		if (this.bridgeServer) return;
		await this.createRunnerFile();
		await this.startBridgeServer();
	}

	async stop() {
		this.sessions.clear();
		await this.stopBridgeServer();
		await this.removeRunnerFile();
	}

	async run(options: SandboxRunOptions): Promise<SandboxResult> {
		if (!this.bridgePort || !this.runnerPath)
			throw new Error("Sandbox service is not initialized");

		const context = options.context ?? {};
		const apiFunctions = options.apiFunctions ?? {};
		const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
		const maxHeapMB = options.maxHeapMB ?? defaultMaxHeapMB;

		const executionId = generateId();
		const token = randomBytes(32).toString("hex");

		this.sessions.set(executionId, {
			token,
			apiFunctions,
			expiresAt: Date.now() + timeoutMs + 2000,
		});

		try {
			let timedOut = false;

			const denoArgs = [
				"run",
				"--no-prompt",
				"--deny-write",
				"--deny-run",
				"--deny-env",
				"--deny-ffi",
				`--allow-net=127.0.0.1:${this.bridgePort}`,
				`--allow-read=${this.runnerPath}`,
				`--v8-flags=--max-heap-size=${maxHeapMB}`,
				this.runnerPath,
			];

			const proc = spawn("deno", denoArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: { PATH: process.env.PATH },
			});

			const clearTimeoutGuard = this.attachTimeoutGuard(proc, timeoutMs, () => {
				timedOut = true;
			});

			const payload = JSON.stringify({
				token,
				context,
				executionId,
				code: options.code,
				apiFunctions: Object.keys(apiFunctions),
				apiBase: `http://127.0.0.1:${this.bridgePort}`,
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
				this.waitForExit(proc),
				this.readStream(proc.stderr),
				this.readStream(proc.stdout),
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
							: resultText || this.formatExit(exit),
				};
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.sessions.delete(executionId);
		}
	}

	private async createRunnerFile() {
		const fileName = `ryot-sandbox-runner-${Date.now()}-${process.pid}.mjs`;
		this.runnerPath = join(tmpdir(), fileName);
		await writeFile(this.runnerPath, sandboxRunnerSource, "utf8");
	}

	private async removeRunnerFile() {
		if (!this.runnerPath) return;
		await rm(this.runnerPath, { force: true });
		this.runnerPath = null;
	}

	private async startBridgeServer() {
		this.bridgeServer = createServer((req, res) => {
			void this.handleBridgeRequest(req, res);
		});

		await new Promise<void>((resolve, reject) => {
			const bridgeServer = this.bridgeServer;
			if (!bridgeServer) {
				reject(new Error("Bridge server not initialized"));
				return;
			}

			const onError = (error: Error) => reject(error);
			bridgeServer.once("error", onError);
			bridgeServer.listen(0, "127.0.0.1", () => {
				bridgeServer.off("error", onError);
				resolve();
			});
		});

		const address = this.bridgeServer.address();
		if (!address || typeof address === "string")
			throw new Error("Failed to allocate sandbox bridge port");

		this.bridgePort = address.port;
	}

	private async stopBridgeServer() {
		if (!this.bridgeServer) {
			this.bridgePort = null;
			return;
		}

		await new Promise<void>((resolve, reject) => {
			this.bridgeServer?.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});

		this.bridgePort = null;
		this.bridgeServer = null;
	}

	private async handleBridgeRequest(req: IncomingMessage, res: ServerResponse) {
		try {
			if (req.method !== "POST" || !req.url) {
				sendJson(res, 404, { error: "Not found" });
				return;
			}

			const url = new URL(req.url, "http://127.0.0.1");
			const segments = url.pathname.split("/").filter(Boolean);
			if (segments.length !== 3 || segments[0] !== "rpc") {
				sendJson(res, 404, { error: "Not found" });
				return;
			}

			const executionId = decodeURIComponent(segments[1] ?? "");
			const fnName = decodeURIComponent(segments[2] ?? "");
			const session = this.sessions.get(executionId);
			if (!session) {
				sendJson(res, 404, { error: "Execution not found" });
				return;
			}

			if (Date.now() > session.expiresAt) {
				this.sessions.delete(executionId);
				sendJson(res, 410, { error: "Execution expired" });
				return;
			}

			const authHeader = req.headers.authorization;
			if (authHeader !== `Bearer ${session.token}`) {
				sendJson(res, 401, { error: "Unauthorized" });
				return;
			}

			const fn = session.apiFunctions[fnName];
			if (!fn) {
				sendJson(res, 404, { error: "Unknown function" });
				return;
			}

			const requestBody = await this.readJsonBody(req);
			const args = Array.isArray(requestBody.args)
				? requestBody.args
				: ([] as Array<unknown>);

			try {
				const result = await fn(...args);
				sendJson(res, 200, { result });
			} catch (error) {
				sendJson(res, 500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		} catch (error) {
			sendJson(res, 400, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async readJsonBody(req: IncomingMessage) {
		let size = 0;
		const chunks: Array<Buffer> = [];

		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.byteLength;
			if (size > requestBodyLimit) {
				throw new Error("Request body too large");
			}
			chunks.push(buffer);
		}

		if (!chunks.length) return {} as { args?: Array<unknown> };

		const text = Buffer.concat(chunks).toString("utf8").trim();
		if (!text) return {} as { args?: Array<unknown> };

		try {
			return JSON.parse(text) as { args?: Array<unknown> };
		} catch {
			throw new Error("Invalid JSON body");
		}
	}

	private async readStream(stream: NodeJS.ReadableStream | null) {
		if (!stream) return "";

		const chunks: Array<string> = [];
		for await (const chunk of stream)
			chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));

		return chunks.join("");
	}

	private waitForExit(proc: ReturnType<typeof spawn>) {
		return new Promise<ProcessExit>((resolve, reject) => {
			proc.once("error", reject);
			proc.once("close", (code, signal) => {
				resolve({ code, signal });
			});
		});
	}

	private attachTimeoutGuard(
		proc: ReturnType<typeof spawn>,
		timeoutMs: number,
		onTimeout: () => void,
	) {
		let forceKillTimer: NodeJS.Timeout | null = null;

		const timeoutTimer = setTimeout(() => {
			onTimeout();
			proc.kill("SIGTERM");

			forceKillTimer = setTimeout(() => {
				proc.kill("SIGKILL");
			}, forceKillDelayMs);
		}, timeoutMs);

		return () => {
			clearTimeout(timeoutTimer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
		};
	}

	private formatExit(exit: ProcessExit) {
		if (exit.signal) return `Sandbox terminated by signal ${exit.signal}`;

		if (typeof exit.code === "number")
			return `Sandbox exited with code ${exit.code}`;

		return "Sandbox exited unexpectedly";
	}
}
