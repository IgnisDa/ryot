import type { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import type { TypeScriptProjectAccess } from "@ryot-app/typescript-compiler";
import { type Cause, Effect } from "effect";
import * as ts from "typescript/unstable/ast";
import { SymbolFlags, type Type, TypeFlags } from "typescript/unstable/async";

import { type SandboxCompilerDiagnostic, sandboxDiagnosticAt } from "./compiler-diagnostics";

const query = <A>(call: () => Promise<A>) => Effect.tryPromise(call);

const children = (node: ts.Node) => {
	const result: ts.Node[] = [];
	node.forEachChild((child) => {
		result.push(child);
	});
	return result;
};

export const analyzeSandboxExecution = Effect.fn("analyzeSandboxExecution")(function* (
	project: TypeScriptProjectAccess,
	entry: ts.SourceFile,
) {
	const checker = project.checker;
	const files = new Set(project.sourceFiles.map((file) => file.fileName));
	const visited = new Set<ts.Node>();
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const required = new Set<string>();
	const optional = new Set<string>();
	const oauth = new Set<string>();
	const executables: SandboxExecutionMetadata["executableDependencies"][number][] = [];
	const analyzedMethods = new Set([
		"getPluginConfig",
		"activity",
		"child",
		"executeWorkflow",
		"getOAuthAccessToken",
	]);
	const fail = (node: ts.Node, message: string) => {
		diagnostics.push(sandboxDiagnosticAt(node, "RYOT_DEPENDENCY", message));
	};
	const stringValues = Effect.fnUntraced(function* (
		type: Type | undefined,
	): Effect.fn.Return<string[] | undefined, Cause.UnknownError> {
		if (!type) {
			return undefined;
		}
		if (type.flags & TypeFlags.Never) {
			return [];
		}
		if (type.isStringLiteralType()) {
			return [type.value];
		}
		if (!type.isUnionType()) {
			return undefined;
		}
		const values: string[] = [];
		for (const member of yield* query(() => type.getTypes())) {
			const strings = yield* stringValues(member);
			if (!strings) {
				return undefined;
			}
			values.push(...strings);
		}
		return values;
	});
	const propertyType = Effect.fnUntraced(function* (type: Type, name: string, node: ts.Node) {
		const symbol = yield* query(() => checker.getPropertyOfType(type, name));
		return symbol ? yield* query(() => checker.getTypeOfSymbolAtLocation(symbol, node)) : undefined;
	});
	const expressions = Effect.fnUntraced(function* (
		expression: ts.Expression,
	): Effect.fn.Return<string[] | undefined, Cause.UnknownError> {
		if (ts.isArrayLiteralExpression(expression)) {
			const result: string[] = [];
			for (const element of expression.elements) {
				const values = ts.isSpreadElement(element)
					? yield* expressions(element.expression)
					: yield* stringValues(yield* query(() => checker.getTypeAtLocation(element)));
				if (!values) {
					return undefined;
				}
				result.push(...values);
			}
			return result;
		}
		const type = yield* query(() => checker.getTypeAtLocation(expression));
		if (!type) {
			return undefined;
		}
		const indices = yield* query(() => checker.getIndexInfosOfType(type));
		const numeric = indices.find((index) => index.keyType.flags & TypeFlags.Number);
		return numeric ? yield* stringValues(numeric.valueType) : undefined;
	});
	const configAccess = Effect.fnUntraced(function* (call: ts.CallExpression) {
		const argument = call.arguments[0];
		if (!argument || !ts.isObjectLiteralExpression(argument)) {
			fail(
				call,
				"Configuration access must be a direct object with required and optional finite key lists",
			);
			return;
		}
		for (const property of argument.properties) {
			if (
				!ts.isPropertyAssignment(property) ||
				!ts.isIdentifier(property.name) ||
				!["required", "optional"].includes(property.name.text)
			) {
				fail(property, "Configuration access supports only required and optional key lists");
				continue;
			}
			const values = yield* expressions(property.initializer);
			if (!values || values.some((value) => !value || value !== value.trim())) {
				fail(
					property.initializer,
					"Configuration keys must be non-empty literals or statically finite values",
				);
				continue;
			}
			for (const value of values) {
				(property.name.text === "required" ? required : optional).add(value);
			}
		}
	});
	const executableAccess = Effect.fnUntraced(function* (
		call: ts.CallExpression,
		kind: "script" | "workflow",
	) {
		const reference = call.arguments[1];
		const type = reference ? yield* query(() => checker.getTypeAtLocation(reference)) : undefined;
		if (!reference || !type) {
			fail(call, "Executable calls require a typed static reference or finite alternatives");
			return;
		}
		const members = type.isUnionType() ? yield* query(() => type.getTypes()) : [type];
		for (const member of members) {
			let slugs = yield* stringValues(
				yield* propertyType(member, kind === "script" ? "scriptSlug" : "workflowSlug", reference),
			);
			if (!slugs) {
				const property = yield* query(() =>
					checker.getPropertyOfType(member, kind === "script" ? "scriptSlug" : "workflowSlug"),
				);
				for (const handle of property?.declarations ?? []) {
					if (!files.has(handle.path)) {
						continue;
					}
					const declaration = yield* query(() => handle.resolve());
					if (
						declaration &&
						ts.isPropertyAssignment(declaration) &&
						!ts.isAssertionExpression(declaration.initializer)
					) {
						slugs = yield* stringValues(
							yield* query(() => checker.getTypeAtLocation(declaration.initializer)),
						);
					}
				}
			}
			const referenceKinds = yield* stringValues(
				yield* propertyType(member, "referenceKind", reference),
			);
			if (!slugs?.length || referenceKinds?.length !== 1 || referenceKinds[0] !== kind) {
				fail(
					reference,
					"Executable targets must use typed static references with finite literal slugs",
				);
				continue;
			}
			const selectionType = yield* propertyType(member, "selection", reference);
			let selection: SandboxExecutionMetadata["executableDependencies"][number]["selection"];
			if (selectionType && !(selectionType.flags & TypeFlags.Undefined)) {
				const id = yield* stringValues(yield* propertyType(selectionType, "id", reference));
				const key = yield* stringValues(yield* propertyType(selectionType, "key", reference));
				const stage = yield* stringValues(yield* propertyType(selectionType, "stage", reference));
				if (
					id?.length !== 1 ||
					key?.length !== 1 ||
					stage?.length !== 1 ||
					(stage[0] !== "settings" && stage[0] !== "record") ||
					!id[0] ||
					!key[0]
				) {
					fail(
						reference,
						"Executable selections must have one literal id, key, and stage per alternative",
					);
					continue;
				}
				selection = { id: id[0], key: key[0], stage: stage[0] };
			}
			for (const slug of slugs) {
				executables.push({ kind, slug, ...(selection ? { selection } : {}) });
			}
		}
	});
	const visit = Effect.fnUntraced(function* (
		node: ts.Node,
	): Effect.fn.Return<void, Cause.UnknownError> {
		if (visited.has(node) || ts.isTypeNode(node) || ts.isImportDeclaration(node)) {
			return;
		}
		visited.add(node);
		if (
			(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
			!(ts.isCallExpression(node.parent) && node.parent.expression === node)
		) {
			const symbol = yield* query(() => checker.getSymbolAtLocation(node));
			const sdk =
				symbol &&
				analyzedMethods.has(symbol.name) &&
				symbol.declarations.some((handle) => handle.path.includes("/sandbox-sdk/src/"));
			if (sdk) {
				fail(
					node,
					"Configuration and executable SDK methods must be called directly; method aliases are unsupported",
				);
			}
		}
		if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
			const name = node.propertyName ?? node.name;
			if (
				name &&
				(ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
				analyzedMethods.has(name.text)
			) {
				const type = yield* query(() => checker.getTypeAtLocation(node.parent));
				const symbol = type
					? yield* query(() => checker.getPropertyOfType(type, name.text))
					: undefined;
				if (symbol?.declarations.some((handle) => handle.path.includes("/sandbox-sdk/src/"))) {
					fail(
						node,
						"Configuration and executable SDK methods must be called directly; method aliases are unsupported",
					);
				}
			}
		}
		if (ts.isCallExpression(node)) {
			const symbol = yield* query(() => checker.getSymbolAtLocation(node.expression));
			const declarations = symbol
				? yield* Effect.forEach(symbol.declarations, (handle) => query(() => handle.resolve()))
				: [];
			const sdkMethod = declarations.some((declaration) =>
				declaration?.getSourceFile().fileName.includes("/sandbox-sdk/src/"),
			);
			if (sdkMethod && symbol) {
				if (symbol.name === "getPluginConfig") {
					yield* configAccess(node);
				}
				if (symbol.name === "activity") {
					yield* executableAccess(node, "script");
				}
				if (symbol.name === "child" || symbol.name === "executeWorkflow") {
					yield* executableAccess(node, "workflow");
				}
				if (symbol.name === "getOAuthAccessToken") {
					const argument = node.arguments[0];
					const fieldProperty =
						argument && ts.isObjectLiteralExpression(argument)
							? argument.properties.find(
									(property) =>
										ts.isPropertyAssignment(property) &&
										ts.isIdentifier(property.name) &&
										property.name.text === "field",
								)
							: undefined;
					const type = argument
						? yield* query(() => checker.getTypeAtLocation(argument))
						: undefined;
					let field: string[] | undefined;
					if (fieldProperty && ts.isPropertyAssignment(fieldProperty)) {
						field = yield* stringValues(
							yield* query(() => checker.getTypeAtLocation(fieldProperty.initializer)),
						);
					} else if (argument && type) {
						field = yield* stringValues(yield* propertyType(type, "field", argument));
					}
					if (!field) {
						fail(node, "OAuth connection fields must be statically finite");
					} else {
						for (const value of field) {
							oauth.add(value);
						}
					}
				}
			}
		}
		if (
			ts.isIdentifier(node) &&
			!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
		) {
			let symbol = yield* query(() => checker.getSymbolAtLocation(node));
			if (symbol && symbol.flags & SymbolFlags.Alias) {
				const alias = symbol;
				symbol = yield* query(() => checker.getAliasedSymbol(alias));
			}
			if (symbol) {
				for (const handle of symbol.declarations) {
					if (!files.has(handle.path)) {
						continue;
					}
					const declaration = yield* query(() => handle.resolve());
					if (!declaration) {
						continue;
					}
					if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
						yield* visit(declaration.initializer);
					}
					if (
						(ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
						declaration.body
					) {
						yield* visit(declaration.body);
					}
					if (ts.isPropertyAssignment(declaration)) {
						yield* visit(declaration.initializer);
					}
					if (ts.isExportAssignment(declaration)) {
						yield* visit(declaration.expression);
					}
				}
			}
		}
		for (const child of children(node)) {
			yield* visit(child);
		}
	});
	for (const statement of entry.statements) {
		if (ts.isExportAssignment(statement)) {
			yield* visit(statement.expression);
		}
	}
	const unique = new Map(executables.map((dependency) => [JSON.stringify(dependency), dependency]));
	return {
		diagnostics,
		metadata: {
			oauthConnectionFields: [...oauth].sort(),
			requiredPluginConfigKeys: [...required].sort(),
			optionalPluginConfigKeys: [...optional].filter((key) => !required.has(key)).sort(),
			executableDependencies: [...unique.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([, dependency]) => dependency),
		} satisfies SandboxExecutionMetadata,
	};
});
