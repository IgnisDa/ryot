import { SANDBOX_SDK_IMPORTS } from "@ryot-app/sandbox-sdk/imports";
import { resolveTypeScriptCompilerPath } from "@ryot-app/typescript-compiler";
import { Effect } from "effect";

import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";

export const resolveSandboxCompilerDependencies = Effect.try({
	try: () => {
		const from = Bun.fileURLToPath(new URL(".", import.meta.url));
		return {
			sdkEntries: Object.fromEntries(
				SANDBOX_SDK_IMPORTS.map((specifier) => [specifier, Bun.resolveSync(specifier, from)]),
			),
			tsserverPath: resolveTypeScriptCompilerPath(from),
		};
	},
	catch: (error) =>
		sandboxCompilationFailure([
			sandboxCompilerDiagnostic(
				"RYOT_COMPILER",
				`Sandbox compiler dependencies could not be resolved: ${String(error)}`,
			),
		]),
});
