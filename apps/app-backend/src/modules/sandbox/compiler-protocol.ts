import { SandboxCompilationFailure } from "@ryot/contract/modules/sandbox/schemas";
import type { SandboxManifest } from "@ryot/sandbox-sdk";
import { Schema } from "effect";

export const SANDBOX_COMPILED_FORMAT = 1 as const;

export type CompiledSandboxModule = {
	readonly javascript: string;
	readonly manifest: SandboxManifest;
	readonly format: typeof SANDBOX_COMPILED_FORMAT;
};

const CompilerWorkerSuccess = Schema.Struct({
	success: Schema.Literal(true),
	value: Schema.Struct({
		manifest: Schema.Unknown,
		javascript: Schema.String,
		format: Schema.Literal(SANDBOX_COMPILED_FORMAT),
	}),
});

const CompilerWorkerFailure = Schema.Struct({
	success: Schema.Literal(false),
	error: SandboxCompilationFailure,
});

export const CompilerWorkerResponse = Schema.Union(CompilerWorkerSuccess, CompilerWorkerFailure);

export type CompilerWorkerResponse = Schema.Schema.Type<typeof CompilerWorkerResponse>;

export const compilerWorkerFailure = (
	error: SandboxCompilationFailure,
): CompilerWorkerResponse => ({ success: false, error });

export const compilerWorkerSuccess = (value: CompiledSandboxModule): CompilerWorkerResponse => ({
	value,
	success: true,
});
