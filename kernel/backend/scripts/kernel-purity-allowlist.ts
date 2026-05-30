import type { PurityAllowlistEntry } from "./kernel-purity";

export const kernelPurityAllowlist = [
	{
		term: "*",
		kind: "permanent",
		category: "legacy-bootstrap",
		path: "kernel/backend/src/modules/legacy-bootstrap/**",
		reason: "Documented V1 adoption quarantine retains domain mappings",
	},
] satisfies ReadonlyArray<PurityAllowlistEntry>;
