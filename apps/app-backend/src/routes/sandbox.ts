import { zValidator } from "@hono/zod-validator";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { getSandboxService } from "../sandbox";

const runSandboxSchema = z.object({
	code: z.string().min(1).max(20_000),
});

type AddNumbersSuccess = { data: number; success: true };
type AddNumbersFailure = { error: string; success: false };
type AddNumbersResult = AddNumbersFailure | AddNumbersSuccess;

type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

type HttpCallSuccess = {
	success: true;
	data: {
		body: string;
		status: number;
		statusText: string;
		headers: Record<string, string>;
	};
};

type HttpCallFailure = {
	error: string;
	success: false;
	status?: number;
};

type HttpCallResult = HttpCallFailure | HttpCallSuccess;

const httpCallTimeoutMs = 8_000;

const mapHeadersToObject = (headers: Headers) => {
	const headerObject: Record<string, string> = {};
	for (const [key, value] of headers.entries()) headerObject[key] = value;
	return headerObject;
};

const parseHttpCallOptions = (options: unknown): HttpCallOptions => {
	if (options === undefined || options === null) return {};
	if (typeof options !== "object" || Array.isArray(options))
		throw new Error("httpCall options must be an object");

	const parsed: HttpCallOptions = {};
	const optionRecord = options as Record<string, unknown>;

	if ("body" in optionRecord) {
		if (optionRecord.body === undefined) parsed.body = undefined;
		else if (typeof optionRecord.body === "string")
			parsed.body = optionRecord.body;
		else throw new Error("httpCall options.body must be a string");
	}

	if ("headers" in optionRecord) {
		if (optionRecord.headers === undefined) {
			parsed.headers = undefined;
		} else if (
			typeof optionRecord.headers === "object" &&
			!Array.isArray(optionRecord.headers) &&
			optionRecord.headers !== null
		) {
			const headerRecord = optionRecord.headers as Record<string, unknown>;
			const headers: Record<string, string> = {};
			for (const key of Object.keys(headerRecord)) {
				const value = headerRecord[key];
				if (typeof value !== "string") {
					throw new Error("httpCall headers must be string values");
				}
				headers[key] = value;
			}
			parsed.headers = headers;
		} else {
			throw new Error("httpCall options.headers must be an object");
		}
	}

	return parsed;
};

const httpCall = async (
	method: unknown,
	url: unknown,
	options: unknown,
): Promise<HttpCallResult> => {
	if (typeof method !== "string" || !method.trim())
		return {
			success: false,
			error: "httpCall expects a non-empty method string",
		};

	if (typeof url !== "string" || !url.trim())
		return {
			success: false,
			error: "httpCall expects a non-empty URL string",
		};

	let requestUrl: URL;
	try {
		requestUrl = new URL(url);
	} catch {
		return {
			success: false,
			error: "httpCall URL is invalid",
		};
	}

	let parsedOptions: HttpCallOptions;
	try {
		parsedOptions = parseHttpCallOptions(options);
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "httpCall options are invalid",
		};
	}

	try {
		const response = await fetch(requestUrl.toString(), {
			body: parsedOptions.body,
			headers: parsedOptions.headers,
			method: method.trim().toUpperCase(),
			signal: AbortSignal.timeout(httpCallTimeoutMs),
		});

		const responseBody = await response.text();
		if (!response.ok) {
			return {
				success: false,
				status: response.status,
				error: `HTTP ${response.status} ${response.statusText}`,
			};
		}

		return {
			success: true,
			data: {
				body: responseBody,
				status: response.status,
				statusText: response.statusText,
				headers: mapHeadersToObject(response.headers),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "httpCall failed",
		};
	}
};

const addNumbers = async (
	a: unknown,
	b: unknown,
): Promise<AddNumbersResult> => {
	const first = Number(a);
	const second = Number(b);

	if (!Number.isFinite(first) || !Number.isFinite(second))
		return {
			success: false,
			error: "addNumbers expects two finite numbers",
		};

	try {
		const result = await db.execute(
			sql`SELECT (${first}::double precision + ${second}::double precision) AS data`,
		);

		if (Math.random() < 0.3)
			return {
				error: "Random demo error from addNumbers",
				success: false,
			};

		const row = result.rows[0] as { data?: number | string } | undefined;
		const data = Number(row?.data);
		if (!Number.isFinite(data))
			return {
				success: false,
				error: "Could not read addNumbers result from database",
			};

		return { data, success: true };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to run addNumbers",
		};
	}
};

export const sandboxApi = new Hono().post(
	"/run",
	zValidator("json", runSandboxSchema),
	async (c) => {
		const parsed = c.req.valid("json");

		const startedAt = Date.now();
		const sandbox = getSandboxService();
		const result = await sandbox.run({
			context: {},
			maxHeapMB: 64,
			timeoutMs: 10_000,
			code: parsed.code,
			apiFunctions: { addNumbers, httpCall },
		});

		return c.json({ ...result, durationMs: Date.now() - startedAt });
	},
);
