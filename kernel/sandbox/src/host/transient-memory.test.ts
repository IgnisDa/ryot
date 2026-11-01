import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { describe, expect, it } from "vitest";

import { SANDBOX_TRANSIENT_MEMORY, sandboxTransientPermitBytes } from "./transient-memory";

const smallNames = new Set([
	"log",
	"span",
	"scratchWrite",
	"getCachedValue",
	"setCachedValue",
	"artifactReadRange",
]);

describe("sandbox transient memory permits", () => {
	it("assigns each host call its result bucket", () => {
		for (const name of [...SANDBOX_HOST_CAPABILITIES, "scratchWrite", "artifactReadRange"]) {
			expect(sandboxTransientPermitBytes(name, 0), name).toBe(
				smallNames.has(name)
					? SANDBOX_TRANSIENT_MEMORY.smallBytes
					: SANDBOX_TRANSIENT_MEMORY.ordinaryBytes,
			);
		}
		expect(sandboxTransientPermitBytes("inlineBatch", 0)).toBe(
			SANDBOX_TRANSIENT_MEMORY.inlineBatchBytes,
		);
		expect(sandboxTransientPermitBytes("journalRead", 0)).toBe(
			SANDBOX_TRANSIENT_MEMORY.journalReadBytes,
		);
		expect(sandboxTransientPermitBytes("unknown", 0)).toBe(SANDBOX_TRANSIENT_MEMORY.ordinaryBytes);
	});
});
