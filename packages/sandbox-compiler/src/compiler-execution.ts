import type { SandboxExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import {
	SANDBOX_HOST_CAPABILITIES,
	type SandboxHostCapability,
} from "@ryot-app/contract/modules/sandbox/wire";
import { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { SANDBOX_SDK_INTRINSICS } from "@ryot-app/sandbox-sdk/intrinsics";
import type { TypeScriptProjectAccess } from "@ryot-app/typescript-compiler";
import { type Cause, Effect } from "effect";
import * as ts from "typescript/unstable/ast";
import { SymbolFlags, type Type, TypeFlags } from "typescript/unstable/async";

import {
	type SandboxCompilerFailure,
	type SandboxCompilerDiagnostic,
	sandboxCompilationFailure,
	sandboxDiagnosticAt,
} from "./compiler-diagnostics";
import { SANDBOX_COMPILER_LIMITS } from "./limits";

const checkerQuery = <A>(call: () => Promise<A>) => Effect.tryPromise(call);

const children = (node: ts.Node) => {
	const result: ts.Node[] = [];
	node.forEachChild((child) => {
		result.push(child);
	});
	return result;
};

export const createSandboxExecutionAnalyzer = (project: TypeScriptProjectAccess) => {
	const checker = project.checker;
	const getSymbolAtLocation = (node: ts.Node) =>
		ts.isIdentifier(node) &&
		ts.isShorthandPropertyAssignment(node.parent) &&
		node.parent.name === node
			? checker.getShorthandAssignmentValueSymbol(node.parent)
			: checker.getSymbolAtLocation(node);
	const getTypeAtLocation = (node: ts.Node) => checker.getTypeAtLocation(node);
	const resolveDeclaration = (
		handle: NonNullable<Awaited<ReturnType<typeof getSymbolAtLocation>>>["declarations"][number],
	) => handle.resolve();
	const getAliasedSymbol = (symbol: NonNullable<Awaited<ReturnType<typeof getSymbolAtLocation>>>) =>
		checker.getAliasedSymbol(symbol);
	type BoundedQuery = <A>(
		call: () => Promise<A>,
	) => Effect.Effect<A, Cause.UnknownError | SandboxCompilerFailure>;
	const symbols = new Map<ts.Node, Awaited<ReturnType<typeof getSymbolAtLocation>>>();
	const types = new Map<ts.Node, Awaited<ReturnType<typeof getTypeAtLocation>>>();
	const declarationCache = new Map<
		Parameters<typeof resolveDeclaration>[0],
		Awaited<ReturnType<typeof resolveDeclaration>>
	>();
	const aliasedSymbols = new Map<
		Parameters<typeof getAliasedSymbol>[0],
		Awaited<ReturnType<typeof getAliasedSymbol>>
	>();
	const symbolAt = Effect.fnUntraced(function* (node: ts.Node, query: BoundedQuery) {
		if (!symbols.has(node)) {
			symbols.set(node, yield* query(() => getSymbolAtLocation(node)));
		}
		return symbols.get(node);
	});
	const typeAt = Effect.fnUntraced(function* (node: ts.Node, query: BoundedQuery) {
		if (!types.has(node)) {
			types.set(node, yield* query(() => getTypeAtLocation(node)));
		}
		return types.get(node);
	});
	const declarationAt = Effect.fnUntraced(function* (
		handle: Parameters<typeof resolveDeclaration>[0],
		query: BoundedQuery,
	) {
		if (!declarationCache.has(handle)) {
			declarationCache.set(handle, yield* query(() => resolveDeclaration(handle)));
		}
		return declarationCache.get(handle);
	});
	const aliasedSymbolAt = Effect.fnUntraced(function* (
		symbol: Parameters<typeof getAliasedSymbol>[0],
		query: BoundedQuery,
	) {
		if (!aliasedSymbols.has(symbol)) {
			aliasedSymbols.set(symbol, yield* query(() => getAliasedSymbol(symbol)));
		}
		return aliasedSymbols.get(symbol);
	});
	return Effect.fn("analyzeSandboxExecution")(function* (
		entry: ts.SourceFile,
		maximumSteps: number = SANDBOX_COMPILER_LIMITS.executionAnalysisSteps,
	) {
		let steps = 0;
		let currentNode: ts.Node = entry;
		const analysisLimit = () =>
			sandboxCompilationFailure([
				sandboxDiagnosticAt(
					currentNode,
					"RYOT_ANALYSIS_LIMIT",
					"Sandbox execution analysis limit exhausted",
				),
			]);
		const query: BoundedQuery = <A>(call: () => Promise<A>) =>
			Effect.gen(function* () {
				steps += 1;
				if (steps > maximumSteps) {
					return yield* analysisLimit();
				}
				return yield* checkerQuery(call);
			});
		const checkSteps = () => (steps > maximumSteps ? Effect.fail(analysisLimit()) : Effect.void);
		const files = new Set(project.sourceFiles.map((file) => file.fileName));
		const visited = new Set<ts.Node>();
		const visitedReceivers = new Map<ts.Node, Set<boolean | string>>();
		const diagnostics = new Map<string, SandboxCompilerDiagnostic>();
		const required = new Set<string>();
		const optional = new Set<string>();
		const capabilities = new Set<SandboxHostCapability>();
		const operations = SANDBOX_HOST_CAPABILITIES.filter(
			(capability) => capability in sandboxHostContracts,
		);
		const intrinsicEntries = Object.entries(SANDBOX_SDK_INTRINSICS).flatMap(([module, exports]) =>
			Object.entries(exports).map(([name, capability]) => ({
				name,
				capability,
				path: `/sandbox-sdk/src/${module.split("/").at(-1)}.ts`,
			})),
		);
		const oauth = new Set<string>();
		const executables: SandboxExecutionMetadata["executableDependencies"][number][] = [];
		const analyzedMethods = new Set([
			"getPluginConfig",
			"activity",
			"child",
			"executeWorkflow",
			"getOAuthAccessToken",
			"invalidateOAuthAccessToken",
			"requestEventStreamWork",
		]);
		const fail = (node: ts.Node, message: string) => {
			const diagnostic = sandboxDiagnosticAt(node, "RYOT_DEPENDENCY", message);
			diagnostics.set(
				`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${message}`,
				diagnostic,
			);
		};
		const sdkOperation = (symbol: Awaited<ReturnType<typeof getSymbolAtLocation>>) =>
			symbol?.declarations.some((handle) => handle.path.endsWith("/sandbox-sdk/src/core.ts"))
				? operations.find((name) => name === symbol.name)
				: undefined;
		const hostAt = Effect.fnUntraced(function* (node: ts.Node) {
			const type = yield* typeAt(node, query);
			return (
				type &&
				(yield* query(() => checker.getPropertiesOfType(type))).some((symbol) =>
					sdkOperation(symbol),
				)
			);
		});
		const stringValues = Effect.fnUntraced(function* (
			type: Type | undefined,
		): Effect.fn.Return<string[] | undefined, Cause.UnknownError | SandboxCompilerFailure> {
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
			return symbol
				? yield* query(() => checker.getTypeOfSymbolAtLocation(symbol, node))
				: undefined;
		});
		const expressions = Effect.fnUntraced(function* (
			expression: ts.Expression,
		): Effect.fn.Return<string[] | undefined, Cause.UnknownError | SandboxCompilerFailure> {
			if (ts.isArrayLiteralExpression(expression)) {
				const result: string[] = [];
				for (const element of expression.elements) {
					const values = ts.isSpreadElement(element)
						? yield* expressions(element.expression)
						: yield* stringValues(yield* typeAt(element, query));
					if (!values) {
						return undefined;
					}
					result.push(...values);
				}
				return result;
			}
			const type = yield* typeAt(expression, query);
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
			const type = reference ? yield* typeAt(reference, query) : undefined;
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
						const declaration = yield* declarationAt(handle, query);
						if (
							declaration &&
							ts.isPropertyAssignment(declaration) &&
							!ts.isAssertionExpression(declaration.initializer)
						) {
							slugs = yield* stringValues(yield* typeAt(declaration.initializer, query));
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
			receiver: boolean | string = false,
		): Effect.fn.Return<void, Cause.UnknownError | SandboxCompilerFailure> {
			const selections = visitedReceivers.get(node) ?? new Set<boolean | string>();
			if (
				(receiver !== false ? selections.has(receiver) : visited.has(node)) ||
				ts.isTypeNode(node) ||
				ts.isImportDeclaration(node)
			) {
				return;
			}
			currentNode = node;
			steps += 1;
			yield* checkSteps();
			if (receiver !== false) {
				selections.add(receiver);
				visitedReceivers.set(node, selections);
			} else {
				visited.add(node);
			}
			let definitionReceiver = false;
			if (ts.isVariableDeclaration(node) && node.initializer) {
				if (!ts.isIdentifier(node.name)) {
					yield* visit(node.name, true);
				}
				yield* visitInitialization(node.initializer);
				return;
			}
			if (receiver !== false && ts.isObjectLiteralExpression(node)) {
				yield* visitInitialization(node);
				return;
			}
			if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
				const symbol = yield* symbolAt(node, query);
				const operation = sdkOperation(symbol);
				if (operation) {
					capabilities.add(operation);
				}
				if (ts.isElementAccessExpression(node) && !operation) {
					const receiverType = yield* typeAt(node.expression, query);
					const names = yield* stringValues(yield* typeAt(node.argumentExpression, query));
					const properties = receiverType
						? yield* query(() => checker.getPropertiesOfType(receiverType))
						: [];
					if (properties.some((property) => sdkOperation(property))) {
						if (!names?.length) {
							fail(node, "SDK host indexing requires statically finite operation names");
						} else {
							for (const name of names) {
								const property = receiverType
									? yield* query(() => checker.getPropertyOfType(receiverType, name))
									: undefined;
								const resolved = sdkOperation(property);
								if (!resolved || analyzedMethods.has(name)) {
									fail(
										node,
										"Indexed SDK dependencies must be called directly with finite arguments",
									);
								} else {
									capabilities.add(resolved);
								}
							}
						}
					}
				}
			}
			if (
				(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
				!(ts.isCallExpression(node.parent) && node.parent.expression === node)
			) {
				const symbol = yield* symbolAt(node, query);
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
				if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
					const type = yield* typeAt(node.parent, query);
					const symbol = type
						? yield* query(() => checker.getPropertyOfType(type, name.text))
						: undefined;
					const operation = sdkOperation(symbol);
					if (operation) {
						capabilities.add(operation);
					}
				}
				if (
					name &&
					(ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
					analyzedMethods.has(name.text)
				) {
					const type = yield* typeAt(node.parent, query);
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
				if (receiver === true) {
					if (node.name && !ts.isIdentifier(node.name)) {
						yield* visit(node.name, true);
					}
					if (node.initializer) {
						yield* visitInitialization(node.initializer);
					}
					return;
				}
			}
			if (ts.isCallExpression(node)) {
				let symbol = yield* symbolAt(node.expression, query);
				if (symbol && symbol.flags & SymbolFlags.Alias) {
					symbol = yield* aliasedSymbolAt(symbol, query);
				}
				const declarations = symbol
					? yield* Effect.forEach(symbol.declarations, (handle) => declarationAt(handle, query))
					: [];
				const sdkMethod = declarations.some((declaration) =>
					declaration?.getSourceFile().fileName.includes("/sandbox-sdk/src/"),
				);
				definitionReceiver =
					receiver !== false &&
					sdkMethod &&
					symbol !== undefined &&
					symbol.name !== "defineManifest" &&
					deferredSdkInitializers.has(symbol.name);
				if (definitionReceiver && typeof receiver === "string") {
					const definition = node.arguments[0];
					if (definition && ts.isObjectLiteralExpression(definition)) {
						yield* visitInitialization(definition);
						for (const property of definition.properties) {
							if (
								ts.isPropertyAssignment(property) &&
								(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
								property.name.text === receiver
							) {
								yield* visit(property.initializer);
							}
							if (
								ts.isShorthandPropertyAssignment(property) &&
								ts.isIdentifier(property.name) &&
								property.name.text === receiver
							) {
								yield* visit(property.name);
							}
						}
						return;
					}
				}
				for (const [index, argument] of node.arguments.entries()) {
					if (!(yield* hostAt(argument))) {
						continue;
					}
					const intrinsic =
						symbol &&
						intrinsicEntries.some(
							(item) =>
								item.name === symbol.name &&
								symbol.declarations.some((handle) => handle.path.endsWith(item.path)),
						);
					if (intrinsic) {
						continue;
					}
					const helper =
						(sdkMethod &&
							symbol?.name === "run" &&
							symbol.declarations.some((handle) =>
								["driver", "provider", "operation", "automation"].some((module) =>
									handle.path.endsWith(`/sandbox-sdk/src/${module}.ts`),
								),
							)) ||
						declarations.some(
							(declaration) =>
								declaration &&
								files.has(declaration.getSourceFile().fileName) &&
								(ts.isFunctionDeclaration(declaration) ||
									ts.isMethodDeclaration(declaration) ||
									ts.isVariableDeclaration(declaration) ||
									ts.isPropertyAssignment(declaration) ||
									ts.isExportAssignment(declaration) ||
									ts.isBindingElement(declaration) ||
									ts.isShorthandPropertyAssignment(declaration) ||
									(ts.isParameterDeclaration(declaration) &&
										declaration.initializer !== undefined)),
						);
					if (!helper) {
						fail(argument, "SDK hosts cannot escape to unresolved or external functions");
						continue;
					}
					const signature = yield* query(() => checker.getResolvedSignature(node));
					const parameters = signature ? yield* query(() => signature.getParameters()) : [];
					const restIndex = signature?.hasRestParameter ? parameters.length - 1 : undefined;
					const parameter =
						parameters[restIndex !== undefined && index >= restIndex ? restIndex : index];
					let parameterType = parameter
						? yield* query(() => checker.getTypeOfSymbolAtLocation(parameter, node))
						: undefined;
					if (parameterType && restIndex !== undefined && index >= restIndex) {
						const restType = parameterType;
						const item = yield* query(() =>
							checker.getPropertyOfType(restType, String(index - restIndex)),
						);
						parameterType = item
							? yield* query(() => checker.getTypeOfSymbolAtLocation(item, node))
							: (yield* query(() => checker.getIndexInfosOfType(restType))).find(
									(info) => info.keyType.flags & TypeFlags.Number,
								)?.valueType;
					}
					const properties = parameterType
						? yield* query(() => checker.getPropertiesOfType(parameterType))
						: [];
					if (!properties.some((property) => sdkOperation(property))) {
						fail(argument, "SDK helper forwarding must preserve resolved host operation types");
					}
				}
				if (sdkMethod && symbol) {
					if (symbol.name === "getPluginConfig") {
						yield* configAccess(node);
					}
					if (symbol.name === "activity") {
						yield* executableAccess(node, "script");
					}
					if (symbol.name === "requestEventStreamWork") {
						yield* executableAccess(node, "script");
					}
					if (symbol.name === "child" || symbol.name === "executeWorkflow") {
						yield* executableAccess(node, "workflow");
					}
					if (
						symbol.name === "getOAuthAccessToken" ||
						symbol.name === "invalidateOAuthAccessToken"
					) {
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
						const type = argument ? yield* typeAt(argument, query) : undefined;
						let field: string[] | undefined;
						if (fieldProperty && ts.isPropertyAssignment(fieldProperty)) {
							field = yield* stringValues(yield* typeAt(fieldProperty.initializer, query));
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
				if (
					(ts.isReturnStatement(node.parent) ||
						ts.isSpreadAssignment(node.parent) ||
						ts.isSpreadElement(node.parent) ||
						ts.isAssertionExpression(node.parent)) &&
					(yield* hostAt(node))
				) {
					fail(node, "SDK hosts cannot be returned, reflected, spread, or type-erased");
				}
				let symbol = yield* symbolAt(node, query);
				if (symbol && symbol.flags & SymbolFlags.Alias) {
					const alias = symbol;
					symbol = yield* aliasedSymbolAt(alias, query);
				}
				if (symbol) {
					for (const intrinsic of intrinsicEntries) {
						if (
							symbol.name === intrinsic.name &&
							symbol.declarations.some((handle) => handle.path.endsWith(intrinsic.path))
						) {
							capabilities.add(intrinsic.capability);
						}
					}
					for (const handle of symbol.declarations) {
						if (!files.has(handle.path)) {
							continue;
						}
						const declaration = yield* declarationAt(handle, query);
						if (!declaration) {
							continue;
						}
						if (
							(ts.isVariableDeclaration(declaration) || ts.isParameterDeclaration(declaration)) &&
							declaration.initializer
						) {
							yield* visit(declaration.initializer, receiver);
						}
						if (
							(ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
							declaration.body
						) {
							for (const parameter of declaration.parameters) {
								if (parameter.initializer) {
									yield* visit(parameter.initializer);
								}
							}
							yield* visit(declaration.body);
						}
						if (ts.isPropertyAssignment(declaration)) {
							yield* visit(declaration.initializer, receiver);
						}
						if (ts.isShorthandPropertyAssignment(declaration)) {
							yield* visit(declaration.name, receiver);
						}
						if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
							const name = declaration.propertyName ?? declaration.name;
							if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
								const type = yield* typeAt(declaration.parent, query);
								const property = type
									? yield* query(() => checker.getPropertyOfType(type, name.text))
									: undefined;
								for (const selectedHandle of property?.declarations ?? []) {
									if (!files.has(selectedHandle.path)) {
										continue;
									}
									const selectedDeclaration = yield* declarationAt(selectedHandle, query);
									if (selectedDeclaration) {
										yield* visit(selectedDeclaration, receiver);
									}
								}
							}
							if (declaration.initializer) {
								yield* visit(declaration.initializer);
							}
						}
						if (ts.isExportAssignment(declaration)) {
							yield* visit(declaration.expression, receiver);
						}
					}
				}
			}
			for (const child of children(node)) {
				let selected: boolean | string = definitionReceiver ? false : receiver;
				if (
					(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
					child === node.expression
				) {
					selected = true;
					if (ts.isPropertyAccessExpression(node)) {
						selected = node.name.text;
					} else if (ts.isStringLiteralLikeNode(node.argumentExpression)) {
						selected = node.argumentExpression.text;
					}
				}
				yield* visit(child, selected);
			}
		});
		const initialized = new Set<ts.SourceFile>();
		const deferredSdkInitializers = new Set([
			"defineManifest",
			"defineScript",
			"defineWorkflow",
			"defineOperation",
			"defineAutomation",
			"defineAutomationPolicy",
			"defineProvider",
		]);
		const visitInitialization = Effect.fnUntraced(function* (
			node: ts.Node,
		): Effect.fn.Return<void, Cause.UnknownError | SandboxCompilerFailure> {
			if (
				ts.isTypeNode(node) ||
				ts.isFunctionDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isArrowFunction(node) ||
				ts.isMethodDeclaration(node)
			) {
				return;
			}
			currentNode = node;
			steps += 1;
			yield* checkSteps();
			if (ts.isAwaitExpression(node)) {
				fail(node, "Asynchronous module initialization is unsupported");
				return;
			}
			if (ts.isCallExpression(node)) {
				let symbol = yield* symbolAt(node.expression, query);
				if (symbol && symbol.flags & SymbolFlags.Alias) {
					symbol = yield* aliasedSymbolAt(symbol, query);
				}
				if (
					symbol &&
					["runSync", "runPromise", "runFork"].includes(symbol.name) &&
					symbol.declarations.some((handle) => handle.path.includes("/effect/"))
				) {
					fail(node, "Effect execution during module initialization is unsupported");
					return;
				}
				if (
					symbol &&
					deferredSdkInitializers.has(symbol.name) &&
					symbol.declarations.some((handle) => handle.path.includes("/sandbox-sdk/src/"))
				) {
					return;
				}
				if (
					symbol &&
					["fn", "fnUntraced", "gen"].includes(symbol.name) &&
					symbol.declarations.some((handle) => handle.path.includes("/effect/"))
				) {
					return;
				}
				if (
					symbol &&
					analyzedMethods.has(symbol.name) &&
					symbol.declarations.some((handle) => handle.path.includes("/sandbox-sdk/src/"))
				) {
					yield* visit(node);
					return;
				}
				yield* visit(node.expression);
			}
			if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
				yield* visit(node);
			}
			for (const child of children(node)) {
				yield* visitInitialization(child);
			}
		});
		const initialize = Effect.fnUntraced(function* (
			file: ts.SourceFile,
		): Effect.fn.Return<void, Cause.UnknownError | SandboxCompilerFailure> {
			if (initialized.has(file)) {
				return;
			}
			initialized.add(file);
			for (const statement of file.statements) {
				if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
					const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
					const bindings = clause?.namedBindings;
					if (
						(ts.isExportDeclaration(statement) && statement.isTypeOnly) ||
						(ts.isImportDeclaration(statement) &&
							statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) ||
						(clause &&
							!clause.name &&
							bindings &&
							ts.isNamedImports(bindings) &&
							bindings.elements.length > 0 &&
							bindings.elements.every((element) => element.isTypeOnly))
					) {
						continue;
					}
					const specifier = statement.moduleSpecifier;
					if (
						!specifier ||
						!ts.isStringLiteralLikeNode(specifier) ||
						!specifier.text.startsWith(".")
					) {
						continue;
					}
					const symbol = yield* symbolAt(specifier, query);
					for (const handle of symbol?.declarations ?? []) {
						if (!files.has(handle.path)) {
							continue;
						}
						const declaration = yield* declarationAt(handle, query);
						if (declaration) {
							yield* initialize(declaration.getSourceFile());
						}
					}
				} else {
					yield* visitInitialization(
						ts.isExportAssignment(statement) ? statement.expression : statement,
					);
				}
			}
		});
		yield* initialize(entry);
		for (const statement of entry.statements) {
			if (ts.isExportAssignment(statement)) {
				yield* visit(statement.expression);
			}
		}
		const unique = new Map(
			executables.map((dependency) => [JSON.stringify(dependency), dependency]),
		);
		return {
			diagnostics: [...diagnostics.values()],
			metadata: {
				capabilities: [...capabilities].sort(),
				oauthConnectionFields: [...oauth].sort(),
				requiredPluginConfigKeys: [...required].sort(),
				optionalPluginConfigKeys: [...optional].filter((key) => !required.has(key)).sort(),
				executableDependencies: [...unique.entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([, dependency]) => dependency),
			} satisfies SandboxExecutionMetadata,
		};
	});
};
