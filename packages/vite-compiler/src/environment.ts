import { Result } from "effect";

import { viteCompilerError } from "./error";
import type { ViteCompilerError } from "./error";

export interface SanitizeEnvironmentOptions {
	readonly includePath?: boolean;
	readonly preserveNames?: readonly string[];
	readonly source?: Readonly<Record<string, string | undefined>>;
}

const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const sanitizeEnvironment = ({
	preserveNames = [],
	includePath = false,
	source = process.env,
}: SanitizeEnvironmentOptions = {}): Result.Result<Record<string, string>, ViteCompilerError> => {
	const names = new Set<string>();
	for (const name of preserveNames) {
		if (!environmentNamePattern.test(name)) {
			return Result.fail(
				viteCompilerError("invalid-input", `Environment variable name is invalid: ${name}`),
			);
		}
		if (name === "PATH") {
			return Result.fail(viteCompilerError("invalid-input", "Use includePath to preserve PATH"));
		}
		names.add(name);
	}
	if (includePath) {
		names.add("PATH");
	}

	const entries: [string, string][] = [];
	for (const name of names) {
		const value = source[name];
		if (value !== undefined) {
			entries.push([name, value]);
		}
	}
	return Result.succeed(Object.fromEntries(entries));
};
