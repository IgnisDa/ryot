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
	readonly pluginRevision: null | {
		readonly ownerId: null | UserId;
		readonly scope: "user" | "system";
		readonly compiledHashes: Readonly<Record<string, string>>;
	};
};
