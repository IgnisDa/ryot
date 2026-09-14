import { TypeScriptCompilerDiagnostic } from "@ryot-app/typescript-compiler";
import { Schema } from "effect";

import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";

const compilationFailedMessage = "Client plugin compilation failed";

export const ClientPluginCompilerDiagnostic = TypeScriptCompilerDiagnostic;

export type ClientPluginCompilerDiagnostic = Schema.Schema.Type<
	typeof ClientPluginCompilerDiagnostic
>;

export class ClientPluginCompilerFailure extends Schema.TaggedError<ClientPluginCompilerFailure>()(
	"ClientPluginCompilerFailure",
	{ message: Schema.String, diagnostics: Schema.Array(ClientPluginCompilerDiagnostic) },
) {}

export const clientPluginCompilerDiagnostic = (
	code: string,
	file: string,
	message: string,
): ClientPluginCompilerDiagnostic => ({
	code,
	file,
	message,
	line: 1,
	column: 1,
	severity: "error",
});

const fitDiagnostic = (diagnostic: ClientPluginCompilerDiagnostic) =>
	diagnostic.message.length <= CLIENT_PLUGIN_COMPILER_LIMITS.diagnosticMessageCharacters
		? diagnostic
		: {
				...diagnostic,
				message: diagnostic.message.slice(
					0,
					CLIENT_PLUGIN_COMPILER_LIMITS.diagnosticMessageCharacters,
				),
			};

export const clientPluginCompilationFailure = (
	diagnostics: readonly ClientPluginCompilerDiagnostic[],
) =>
	new ClientPluginCompilerFailure({
		message: compilationFailedMessage,
		diagnostics: diagnostics
			.slice(0, CLIENT_PLUGIN_COMPILER_LIMITS.diagnosticCount)
			.map(fitDiagnostic),
	});
