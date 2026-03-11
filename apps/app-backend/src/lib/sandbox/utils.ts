import { forceKillDelayMs } from "./constants";

type SandboxProcess = ReturnType<typeof Bun.spawn>;

export type ProcessExit = {
	code: number | null;
	signal: string | null;
};

export const sendJson = (status: number, payload: Record<string, unknown>) => {
	return Response.json(payload, { status });
};

export const readStream = async (stream: ReadableStream | null) => {
	if (!stream) return "";

	return new Response(stream).text();
};

export const waitForExit = async (proc: SandboxProcess) => {
	await proc.exited;
	return {
		code: proc.exitCode,
		signal: proc.signalCode,
	} satisfies ProcessExit;
};

export const attachTimeoutGuard = (
	proc: SandboxProcess,
	timeoutMs: number,
	onTimeout: () => void,
) => {
	let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

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
