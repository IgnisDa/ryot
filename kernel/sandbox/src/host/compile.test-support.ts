import { SandboxScriptManifest } from "@ryot-app/contract/modules/sandbox/schemas";
import { compileSandboxSource } from "@ryot-app/plugin-backend-compiler/core";
import { Effect, Schema } from "effect";

export const compileTestScript = Effect.fnUntraced(function* (source: string) {
	const compiled = yield* compileSandboxSource(source);
	return {
		format: compiled.format,
		javascript: compiled.javascript,
		manifest: yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(compiled.manifest),
	};
});
