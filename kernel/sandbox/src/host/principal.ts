import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";

export type SandboxPrincipal = {
	readonly contentHash: string;
	readonly scriptId: SandboxScriptId;
	readonly metadata: SandboxScriptMetadata;
	readonly subject: SandboxExecutionSubject;
	readonly pluginRevision: {
		readonly ownerId: UserId | null;
		readonly scope: "system" | "user";
		readonly compiledHashes: Readonly<Record<string, string>>;
	} | null;
};
