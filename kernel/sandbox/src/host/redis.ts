import { Context } from "effect";
import type Redis from "ioredis";

export class SandboxRedis extends Context.Service<SandboxRedis, { readonly client: Redis }>()(
	"SandboxRedis",
) {}

export const sandboxRedisKeys = {
	crashWindow: (identity: string) => `ryot:sandbox:crashes:${encodeURIComponent(identity)}`,
	probation: (identity: string) => `ryot:sandbox:probation:${encodeURIComponent(identity)}`,
	quarantine: (identity: string) => `ryot:sandbox:quarantine:${encodeURIComponent(identity)}`,
	recovery: (executionId: string) => `ryot:sandbox:recovery:${encodeURIComponent(executionId)}`,
	probationLease: (identity: string) =>
		`ryot:sandbox:probation-lease:${encodeURIComponent(identity)}`,
};
