import { Schema } from "effect";

export const ViteDiagnosticLocation = Schema.Struct({ line: Schema.Int, column: Schema.Int });

export type ViteDiagnosticLocation = typeof ViteDiagnosticLocation.Type;

export const ViteCompilerErrorReason = Schema.Literals([
	"vite-build",
	"invalid-input",
	"invalid-output",
	"workspace-collision",
	"workspace-filesystem",
]);

export type ViteCompilerErrorReason = typeof ViteCompilerErrorReason.Type;

export const ViteDiagnostic = Schema.Struct({
	message: Schema.String,
	code: Schema.optionalKey(Schema.String),
	file: Schema.optionalKey(Schema.String),
	frame: Schema.optionalKey(Schema.String),
	plugin: Schema.optionalKey(Schema.String),
	severity: Schema.Literals(["error", "warning"]),
	location: Schema.optionalKey(ViteDiagnosticLocation),
});

export type ViteDiagnostic = typeof ViteDiagnostic.Type;

export class ViteCompilerError extends Schema.TaggedError<
	ViteCompilerError,
	{ readonly brand: unique symbol }
>()("ViteCompilerError", {
	message: Schema.String,
	reason: ViteCompilerErrorReason,
	cause: Schema.optionalKey(Schema.Unknown),
	diagnostics: Schema.optionalKey(Schema.Array(ViteDiagnostic)),
}) {}

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
