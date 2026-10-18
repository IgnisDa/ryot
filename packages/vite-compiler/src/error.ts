import { Data } from "effect";

export interface ViteDiagnosticLocation {
	readonly line: number;
	readonly column: number;
}

export type ViteCompilerErrorReason =
	| "vite-build"
	| "invalid-input"
	| "invalid-output"
	| "workspace-collision"
	| "workspace-filesystem";

export interface ViteDiagnostic {
	readonly code?: string;
	readonly file?: string;
	readonly frame?: string;
	readonly message: string;
	readonly plugin?: string;
	readonly severity: "error" | "warning";
	readonly location?: ViteDiagnosticLocation;
}

export class ViteCompilerError extends Data.TaggedError("ViteCompilerError")<{
	readonly message: string;
	readonly cause?: unknown;
	readonly reason: ViteCompilerErrorReason;
	readonly diagnostics?: readonly ViteDiagnostic[];
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
