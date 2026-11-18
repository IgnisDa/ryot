// A replay or recovery continues a run that already holds admitted work.
export const sandboxReplayPriority = (payload: {
	readonly journalLength: number;
	readonly recoveryAttempt?: number | undefined;
}) => (payload.journalLength > 0 || (payload.recoveryAttempt ?? 0) > 0 ? 0 : 1);
