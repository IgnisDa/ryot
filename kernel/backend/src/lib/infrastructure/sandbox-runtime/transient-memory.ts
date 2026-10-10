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

const smallCapabilities = new Set([
	"log",
	"span",
	"scratchWrite",
	"getCachedValue",
	"setCachedValue",
	"artifactReadRange",
]);

export const sandboxTransientPermitBytes = (name: string, argsBytes: number) => {
	let resultBytes: number = SANDBOX_TRANSIENT_MEMORY.ordinaryBytes;
	if (name === "inlineBatch") {
		resultBytes = SANDBOX_TRANSIENT_MEMORY.inlineBatchBytes;
	} else if (name === "journalRead") {
		resultBytes = SANDBOX_TRANSIENT_MEMORY.journalReadBytes;
	} else if (smallCapabilities.has(name)) {
		resultBytes = SANDBOX_TRANSIENT_MEMORY.smallBytes;
	}
	return SANDBOX_JSON_GRAPH_FACTOR * argsBytes + resultBytes;
};
