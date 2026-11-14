import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";

// A policy or required hook blocks the write that awaits it under a deadline; a replay or recovery
// continues a run that already holds admitted work.
export const sandboxReplayPriority = (payload: {
	readonly journalLength: number;
	readonly recoveryAttempt?: number | undefined;
	readonly principal: { readonly subject: SandboxExecutionSubject };
}) => {
	const { subject } = payload.principal;
	if (subject.type === "automation-run" && subject.delivery !== "async") {
		return 0;
	}
	return payload.journalLength > 0 || (payload.recoveryAttempt ?? 0) > 0 ? 1 : 2;
};
