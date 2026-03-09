import type { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";
import { forceKillDelayMs } from "./constants";

export type ProcessExit = {
	code: number | null;
	signal: NodeJS.Signals | null;
};

export const sendJson = (
	res: ServerResponse,
	status: number,
	payload: Record<string, unknown>,
) => {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
};

export const readStream = async (stream: NodeJS.ReadableStream | null) => {
	if (!stream) return "";

	const chunks: Array<string> = [];
	for await (const chunk of stream)
		chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));

	return chunks.join("");
};

export const waitForExit = (proc: ReturnType<typeof spawn>) => {
	return new Promise<ProcessExit>((resolve, reject) => {
		proc.once("error", reject);
		proc.once("close", (code, signal) => {
			resolve({ code, signal });
		});
	});
};

export const attachTimeoutGuard = (
	proc: ReturnType<typeof spawn>,
	timeoutMs: number,
	onTimeout: () => void,
) => {
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
};

export const formatExit = (exit: ProcessExit) => {
	if (exit.signal) return `Sandbox terminated by signal ${exit.signal}`;

	if (typeof exit.code === "number")
		return `Sandbox exited with code ${exit.code}`;

	return "Sandbox exited unexpectedly";
};
