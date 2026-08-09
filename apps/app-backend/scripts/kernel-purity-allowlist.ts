import type { PurityAllowlistEntry } from "./kernel-purity";

export const kernelPurityAllowlist = [
	{
		term: "*",
		kind: "permanent",
		category: "legacy-bootstrap",
		path: "apps/app-backend/src/modules/legacy-bootstrap/**",
		reason: "Documented V1 adoption quarantine retains domain mappings",
	},
	...(["fitness", "media"] as const).map((term) => ({
		term,
		kind: "permanent" as const,
		category: "boot-wiring" as const,
		path: "apps/app-backend/src/modules/plugins/boot-sources.ts",
		reason: "First-party trusted package wiring is intentionally explicit at boot",
	})),
	...(["library", "media"] as const).map((term) => ({
		term,
		kind: "permanent" as const,
		category: "v2-backup-bootstrap" as const,
		path: "apps/app-backend/src/modules/backups/archive-v2/schemas.ts",
		reason: "The backup bootstrap identity must retain its exact wire vocabulary",
	})),
] satisfies ReadonlyArray<PurityAllowlistEntry>;
