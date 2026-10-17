import type { SandboxHttpProgress } from "./http-progress";

export const rateLimitFailure = {
	state: "failure" as const,
	error: {
		message: "HTTP 429" as const,
		data: { body: "slow down", status: 429 as const, headers: { "retry-after": "2" } },
	},
};

export const httpProgressPhases = (
	declaration: Extract<
		SandboxHttpProgress["phase"],
		{ _tag: "ApplyingRateLimitBlock" }
	>["declaration"],
): ReadonlyArray<SandboxHttpProgress["phase"]> => [
	{ rateLimit: null, _tag: "Admitting" },
	{ _tag: "Admitting", rateLimit: rateLimitFailure },
	{ declaration, delayMs: 2_000, rateLimit: rateLimitFailure, _tag: "ApplyingRateLimitBlock" },
	{ blockedUntilMs: 2_000, rateLimit: rateLimitFailure, _tag: "WaitingForRateLimitBlock" },
];
