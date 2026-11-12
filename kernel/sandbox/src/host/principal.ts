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
		readonly scriptsDigest: string;
		readonly ownerId: null | UserId;
		readonly scope: "user" | "system";
	};
};

export const sandboxUserIsolationIdentity = (principal: SandboxPrincipal) => {
	const revision = principal.pluginRevision;
	if (revision === null && principal.subject.type === "agent") {
		return { ownerId: principal.subject.userId, contentHash: principal.contentHash };
	}
	return revision?.scope === "user" && revision.ownerId !== null
		? { ownerId: revision.ownerId, contentHash: revision.scriptsDigest }
		: null;
};
