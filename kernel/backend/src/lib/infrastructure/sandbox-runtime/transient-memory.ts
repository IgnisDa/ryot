import { isSandboxCapability } from "./capability-policy";
import { sandboxHostPermit } from "./host-execution-policy";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import { MiB } from "./limits";

// Each permit covers the decoded argument graph plus the unit's result term; inline batches also
// cover their evidence until the run ends.
export const SANDBOX_TRANSIENT_MEMORY = {
	evidenceCopies: 3,
	smallBytes: 8 * MiB,
	ordinaryBytes: 56 * MiB,
	journalReadBytes: 8 * MiB,
	inlineValueBytes: 80 * MiB,
	inlineBatchBytes: 145 * MiB,
	inlineEvidenceBytes: 60 * MiB,
} as const;

const controlResultBytes = new Map<string, number>([
	["inlineBatch", SANDBOX_TRANSIENT_MEMORY.inlineBatchBytes],
	["journalRead", SANDBOX_TRANSIENT_MEMORY.journalReadBytes],
	["scratchWrite", SANDBOX_TRANSIENT_MEMORY.smallBytes],
	["artifactReadRange", SANDBOX_TRANSIENT_MEMORY.smallBytes],
]);

const capabilityResultBytes = (name: string) =>
	isSandboxCapability(name) && sandboxHostPermit(name) === "small"
		? SANDBOX_TRANSIENT_MEMORY.smallBytes
		: SANDBOX_TRANSIENT_MEMORY.ordinaryBytes;

export const sandboxTransientPermitBytes = (name: string, argsBytes: number) =>
	SANDBOX_JSON_GRAPH_FACTOR * argsBytes +
	(controlResultBytes.get(name) ?? capabilityResultBytes(name));
