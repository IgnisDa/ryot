import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { redis } from "~/lib/redis";
import { requestBodyLimit } from "./constants";
import type { ApiFunction } from "./types";
import { sendJson } from "./utils";

export interface ExecutionSession {
	token: string;
	userId: string;
	expiresAt: number;
	apiFunctions: Record<string, ApiFunction>;
}

export class BridgeServer {
	private port: number | null = null;
	private server: Server | null = null;
	private readonly keyPrefix = "sandbox:session:";
	private readonly userIds = new Map<string, string>();
	private readonly apiFunctions = new Map<
		string,
		Record<string, ApiFunction>
	>();

	async start() {
		this.server = createServer((req, res) => {
			void this.handleRequest(req, res);
		});

		await new Promise<void>((resolve, reject) => {
			const server = this.server;
			if (!server) {
				reject(new Error("Bridge server not initialized"));
				return;
			}

			const onError = (error: Error) => reject(error);
			server.once("error", onError);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", onError);
				resolve();
			});
		});

		const address = this.server.address();
		if (!address || typeof address === "string")
			throw new Error("Failed to allocate sandbox bridge port");

		this.port = address.port;
	}

	async stop() {
		if (!this.server) {
			this.port = null;
			return;
		}

		await new Promise<void>((resolve, reject) => {
			this.server?.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});

		this.port = null;
		this.server = null;
	}

	getPort() {
		return this.port;
	}

	async addSession(executionId: string, session: ExecutionSession) {
		const key = this.getKey(executionId);
		const ttlSeconds = Math.ceil((session.expiresAt - Date.now()) / 1000);
		const data = {
			token: session.token,
			userId: session.userId,
			expiresAt: session.expiresAt,
		};
		await redis.setex(key, ttlSeconds, JSON.stringify(data));
		this.apiFunctions.set(executionId, session.apiFunctions);
		this.userIds.set(executionId, session.userId);
	}

	async removeSession(executionId: string) {
		const key = this.getKey(executionId);
		await redis.del(key);
		this.apiFunctions.delete(executionId);
		this.userIds.delete(executionId);
	}

	async clearSessions() {
		const pattern = `${this.keyPrefix}*`;
		const keys = await redis.keys(pattern);
		if (keys.length > 0) await redis.del(...keys);
		this.apiFunctions.clear();
		this.userIds.clear();
	}

	private getKey(executionId: string): string {
		return `${this.keyPrefix}${executionId}`;
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse) {
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

			const key = this.getKey(executionId);
			const value = await redis.get(key);
			if (!value) {
				sendJson(res, 404, { error: "Execution not found" });
				return;
			}

			const sessionData = JSON.parse(value) as {
				token: string;
				userId: string;
				expiresAt: number;
			};

			if (Date.now() > sessionData.expiresAt) {
				await this.removeSession(executionId);
				sendJson(res, 410, { error: "Execution expired" });
				return;
			}

			const authHeader = req.headers.authorization;
			if (authHeader !== `Bearer ${sessionData.token}`) {
				sendJson(res, 401, { error: "Unauthorized" });
				return;
			}

			const executionFunctions = this.apiFunctions.get(executionId);
			if (!executionFunctions) {
				sendJson(res, 404, { error: "Execution functions not found" });
				return;
			}

			if (!Object.hasOwn(executionFunctions, fnName)) {
				sendJson(res, 404, { error: "Unknown function" });
				return;
			}

			const fn = executionFunctions[fnName];
			if (typeof fn !== "function") {
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
}
