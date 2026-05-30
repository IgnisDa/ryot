import { dayjs } from "@ryot/ts-utils/dayjs";
import { extractErrorMessage } from "@ryot/ts-utils/error";

import { redis } from "~/lib/redis";
import { redisKeys, redisValues, type SandboxSessionRedisValue } from "~/lib/redis-keys";

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
	private readonly apiFunctions = new Map<string, Record<string, BoundHostFunction>>();

	start() {
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
		const key = redisKeys.sandbox.session(executionId);
		const ttlSeconds = Math.ceil(dayjs(session.expiresAt).diff(dayjs(), "second", true));
		const data: SandboxSessionRedisValue = {
			token: session.token,
			expiresAt: session.expiresAt,
		};
		await redis.setex(key, ttlSeconds, redisValues.sandbox.session.stringify(data));
		this.apiFunctions.set(executionId, session.apiFunctions);
	}

	async removeSession(executionId: string) {
		const key = redisKeys.sandbox.session(executionId);
		await redis.del(key);
		this.apiFunctions.delete(executionId);
	}

	async clearSessions() {
		const pattern = redisKeys.sandbox.sessionPattern();
		const keys = await redis.keys(pattern);
		if (keys.length > 0) {
			await redis.del(...keys);
		}
		this.apiFunctions.clear();
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

			const key = redisKeys.sandbox.session(executionId);
			const value = await redis.get(key);
			if (!value) {
				return sendJson(404, { error: "Execution not found" });
			}

			const sessionData = redisValues.sandbox.session.parse(value);

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
					error: extractErrorMessage(error, String(error)),
				});
			}
		} catch (error) {
			return sendJson(400, {
				error: extractErrorMessage(error, String(error)),
			});
		}
	}

	private async readJsonBody(req: Request): Promise<{ args?: Array<unknown> }> {
		if (!req.body) {
			return {};
		}

		const contentLength = req.headers.get("content-length");
		if (contentLength && Number(contentLength) > requestBodyLimit) {
			throw new Error("Request body too large");
		}

		const text = await req.text();
		const trimmedText = text.trim();
		if (!trimmedText) {
			return {};
		}

		if (new TextEncoder().encode(trimmedText).byteLength > requestBodyLimit) {
			throw new Error("Request body too large");
		}

		try {
			// oxlint-disable-next-line no-unsafe-type-assertion
			return JSON.parse(trimmedText) as { args?: Array<unknown> };
		} catch {
			throw new Error("Invalid JSON body");
		}
	}
}
