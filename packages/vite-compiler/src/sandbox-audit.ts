import {
	inspectJavaScriptReferences,
	literalString,
} from "@ryot-app/typescript-compiler/javascript-references";
import { Result } from "effect";

import { viteCompilerError } from "./error";
import type { ViteCompilerError } from "./error";

const forbiddenImportPattern = /^(?:node:|bun:|https?:|npm:|jsr:)/;
const forbiddenViteIdentifiers = new Set([
	"__vitePreload",
	"__vite__mapDeps",
	"__vite_browser_external",
]);

export const invalidSandboxOutput = (message: string) =>
	viteCompilerError("invalid-output", message, undefined, [{ message, severity: "error" }]);

export const auditSandboxEsmOutput = (
	javascript: string,
	approvedExternalSpecifiers: ReadonlySet<string>,
	approvedDynamicImportExpressions: ReadonlySet<string> = new Set(),
): Result.Result<readonly string[], ViteCompilerError> => {
	let forbiddenHelper: string | undefined;
	let references: ReturnType<typeof inspectJavaScriptReferences>;
	try {
		references = inspectJavaScriptReferences(javascript, (node) => {
			if (node.type === "Identifier") {
				const name = typeof node.name === "string" ? node.name : undefined;
				if (name === "Bun" || (name && forbiddenViteIdentifiers.has(name))) {
					forbiddenHelper ??= name;
				}
			} else if (node.type === "CallExpression") {
				const { callee } = node;
				if (
					callee.type === "Identifier" &&
					(callee.name === "require" || callee.name === "__require")
				) {
					forbiddenHelper ??= callee.name;
				} else if (
					callee.type === "MemberExpression" &&
					!callee.computed &&
					callee.object.type === "Identifier" &&
					callee.object.name === "document" &&
					callee.property.type === "Identifier" &&
					callee.property.name === "getElementsByTagName"
				) {
					forbiddenHelper ??= "document.getElementsByTagName";
				}
			} else if (
				node.type === "NewExpression" &&
				node.callee.type === "Identifier" &&
				node.callee.name === "Event" &&
				node.arguments[0] &&
				literalString(node.arguments[0]) === "vite:preloadError"
			) {
				forbiddenHelper ??= "vite:preloadError Event";
			}
		});
	} catch (cause) {
		return Result.fail(
			invalidSandboxOutput(`Sandbox ESM output could not be parsed: ${String(cause)}`),
		);
	}
	if (forbiddenHelper) {
		return Result.fail(
			invalidSandboxOutput(
				`Sandbox ESM output contains a forbidden runtime helper: ${forbiddenHelper}`,
			),
		);
	}
	if (
		references.dynamicExpressions.some(
			(expression) => !approvedDynamicImportExpressions.has(expression),
		)
	) {
		return Result.fail(
			invalidSandboxOutput("Sandbox ESM output contains a non-literal dynamic import"),
		);
	}
	for (const specifier of references.imports) {
		if (forbiddenImportPattern.test(specifier)) {
			return Result.fail(
				invalidSandboxOutput(
					`Sandbox ESM output contains a forbidden runtime import: ${specifier}`,
				),
			);
		}
		if (!approvedExternalSpecifiers.has(specifier)) {
			return Result.fail(
				invalidSandboxOutput(
					`Sandbox ESM output contains an unapproved external import: ${specifier}`,
				),
			);
		}
	}
	return Result.succeed([...new Set(references.imports)].sort());
};
