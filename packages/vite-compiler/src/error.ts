import { Data } from "effect";

export type ViteCompilerErrorReason =
	| "invalid-input"
	| "invalid-output"
	| "vite-build"
	| "workspace-collision"
	| "workspace-filesystem"
	| "workspace-symlink";

export interface ViteDiagnosticLocation {
	readonly line: number;
	readonly column: number;
}

export interface ViteDiagnostic {
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly code?: string;
	readonly plugin?: string;
	readonly file?: string;
	readonly location?: ViteDiagnosticLocation;
	readonly frame?: string;
}

export class ViteCompilerError extends Data.TaggedError("ViteCompilerError")<{
	readonly reason: ViteCompilerErrorReason;
	readonly message: string;
	readonly cause?: unknown;
	readonly diagnostics?: readonly ViteDiagnostic[];
}> {}

export class ViteBuildInvocationError extends Data.TaggedError("ViteBuildInvocationError")<{
	readonly cause: unknown;
}> {}

export const viteCompilerError = (
	reason: ViteCompilerErrorReason,
	message: string,
	cause?: unknown,
	diagnostics?: readonly ViteDiagnostic[],
) =>
	new ViteCompilerError({
		reason,
		message,
		...(cause === undefined ? {} : { cause }),
		...(diagnostics === undefined ? {} : { diagnostics }),
	});
