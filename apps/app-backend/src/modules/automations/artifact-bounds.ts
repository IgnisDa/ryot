import { stableStringify } from "@ryot/ts-utils/json";
import { isObjectRecord } from "@ryot/ts-utils/predicates";

import {
	sandboxArtifactLimits,
	utf8ByteLength,
} from "#lib/infrastructure/sandbox-runtime/serialization-bounds";

export const automationArtifactLimits = {
	...sandboxArtifactLimits,
	maxTriggerSnapshotBytes: 256 * 1024,
} as const;

export const boundTriggerSnapshot = (snapshot: Record<string, unknown>) => {
	const serialized = stableStringify(snapshot);
	const byteSize = utf8ByteLength(serialized);
	if (byteSize <= automationArtifactLimits.maxTriggerSnapshotBytes) {
		return snapshot;
	}
	const automation = isObjectRecord(snapshot["automation"]) ? snapshot["automation"] : {};
	return {
		truncated: true,
		originalByteSize: byteSize,
		hash: new Bun.CryptoHasher("sha256").update(serialized).digest("base64url"),
		core: {
			origin: automation["origin"],
			ruleId: automation["ruleId"],
			source: automation["source"],
			operation: automation["operation"],
			occurrenceId: automation["occurrenceId"],
		},
	};
};
