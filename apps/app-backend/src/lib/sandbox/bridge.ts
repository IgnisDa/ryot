import { dayjs } from "@ryot/ts-utils";

import { redis } from "~/lib/redis";

import { requestBodyLimit } from "./constants";
import { sendJson } from "./utils";

type BoundHostFunction = (...args: Array<unknown>) => Promise<unknown>;

export interface ExecutionSession {
	token: string;
	expiresAt: number;
	apiFunctions: Record<string, BoundHostFunction>;
}

export class BridgeServer {
	private port: number | null = null;
	private server: Bun.Server<undefined> | null = null;
	private readonly keyPrefix = "sandbox:session:";
	private readonly apiFunctions = new Map<string, Record<string, BoundHostFunction>>();

	async start() {
		this.server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (req) => this.handleRequest(req),
		});

		if (!this.server.port) {
			throw new Error("Failed to allocate sandbox bridge port");
		}

		this.port = this.server.port;
	}

	async stop() {
		if (!this.server) {
			this.port = null;
			return;
		}

		await this.server.stop(true);

		this.port = null;
		this.server = null;
	}

	getPort() {
		return this.port;
	}

	async addSession(executionId: string, session: ExecutionSession) {
		const key = this.getKey(executionId);
		const ttlSeconds = Math.ceil(dayjs(session.expiresAt).diff(dayjs(), "second", true));
		const data = {
			token: session.token,
			expiresAt: session.expiresAt,
		};
		await redis.setex(key, ttlSeconds, JSON.stringify(data));
		this.apiFunctions.set(executionId, session.apiFunctions);
	}

	async removeSession(executionId: string) {
		const key = this.getKey(executionId);
		await redis.del(key);
		this.apiFunctions.delete(executionId);
	}

	async clearSessions() {
		const pattern = `${this.keyPrefix}*`;
		const keys = await redis.keys(pattern);
		if (keys.length > 0) {
			await redis.del(...keys);
		}
		this.apiFunctions.clear();
	}

	private getKey(executionId: string): string {
		return `${this.keyPrefix}${executionId}`;
	}

	private async handleRequest(req: Request) {
		try {
			if (req.method !== "POST") {
				return sendJson(404, { error: "Not found" });
			}

			const url = new URL(req.url);
			const segments = url.pathname.split("/").filter(Boolean);
			if (segments.length !== 3 || segments[0] !== "rpc") {
				return sendJson(404, { error: "Not found" });
			}

			const executionId = decodeURIComponent(segments[1] ?? "");
			const fnName = decodeURIComponent(segments[2] ?? "");

			const key = this.getKey(executionId);
			const value = await redis.get(key);
			if (!value) {
				return sendJson(404, { error: "Execution not found" });
			}

			const sessionData = JSON.parse(value) as {
				token: string;
				expiresAt: number;
			};

			if (dayjs().isAfter(dayjs(sessionData.expiresAt))) {
				await this.removeSession(executionId);
				return sendJson(410, { error: "Execution expired" });
			}

			const authHeader = req.headers.get("authorization");
			if (authHeader !== `Bearer ${sessionData.token}`) {
				return sendJson(401, { error: "Unauthorized" });
			}

			const executionFunctions = this.apiFunctions.get(executionId);
			if (!executionFunctions) {
				return sendJson(404, { error: "Execution functions not found" });
			}

			if (!Object.hasOwn(executionFunctions, fnName)) {
				return sendJson(404, { error: "Unknown function" });
			}

			const fn = executionFunctions[fnName];
			if (typeof fn !== "function") {
				return sendJson(404, { error: "Unknown function" });
			}

			const requestBody = await this.readJsonBody(req);
			const args = Array.isArray(requestBody.args) ? requestBody.args : ([] as Array<unknown>);

			try {
				const result = await fn(...args);
				return sendJson(200, { result });
			} catch (error) {
				return sendJson(500, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		} catch (error) {
			return sendJson(400, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async readJsonBody(req: Request) {
		if (!req.body || typeof req.body.getReader !== "function") {
			return {} as { args?: Array<unknown> };
		}

		let offset = 0;
		let size = 0;
		const reader = req.body.getReader();
		const chunks: Array<Uint8Array> = [];

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (!value) {
					continue;
				}

				size += value.byteLength;
				if (size > requestBodyLimit) {
					throw new Error("Request body too large");
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}

		if (!chunks.length) {
			return {} as { args?: Array<unknown> };
		}

		const bytes = new Uint8Array(size);
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}

		const text = new TextDecoder().decode(bytes).trim();
		if (!text) {
			return {} as { args?: Array<unknown> };
		}

		try {
			return JSON.parse(text) as { args?: Array<unknown> };
		} catch {
			throw new Error("Invalid JSON body");
		}
	}
}
