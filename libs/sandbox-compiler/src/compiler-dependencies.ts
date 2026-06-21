import { SANDBOX_SDK_IMPORTS } from "@ryot/sandbox-sdk/imports";
import { Effect } from "effect";

import { sandboxCompilationFailure, sandboxCompilerDiagnostic } from "./compiler-diagnostics";

export const resolveSandboxCompilerDependencies = Effect.try({
	try: () => {
		const from = Bun.fileURLToPath(new URL(".", import.meta.url));
		const typescriptPackage = Bun.resolveSync("typescript/package.json", from);
		const typescriptDirectory = typescriptPackage.slice(0, typescriptPackage.lastIndexOf("/"));
		const nativePackage = `@typescript/typescript-${process.platform}-${process.arch}`;
		const nativePackageJson = Bun.resolveSync(`${nativePackage}/package.json`, typescriptDirectory);
		const nativeDirectory = nativePackageJson.slice(0, nativePackageJson.lastIndexOf("/"));
		return {
			sdkEntries: Object.fromEntries(
				SANDBOX_SDK_IMPORTS.map((specifier) => [specifier, Bun.resolveSync(specifier, from)]),
			),
			tsserverPath: `${nativeDirectory}/lib/tsc${process.platform === "win32" ? ".exe" : ""}`,
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
