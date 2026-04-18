import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem } from "typescript/unstable/fs";

import { discoverSourceFiles, REPOSITORY_ROOT, toRepositoryPath } from "./scope";

const virtualRoot = "/__ryot_effect_v4_guard__";
const virtualConfigFile = `${virtualRoot}/tsconfig.json`;

const from = Bun.fileURLToPath(new URL(".", import.meta.url));
const typescriptPackage = Bun.resolveSync("typescript/package.json", from);
const typescriptDirectory = typescriptPackage.slice(0, typescriptPackage.lastIndexOf("/"));
const nativePackage = `@typescript/typescript-${process.platform}-${process.arch}`;
const nativePackageJson = Bun.resolveSync(`${nativePackage}/package.json`, typescriptDirectory);
const nativeDirectory = nativePackageJson.slice(0, nativePackageJson.lastIndexOf("/"));
const tsserverPath = `${nativeDirectory}/lib/tsc${process.platform === "win32" ? ".exe" : ""}`;

export type GuardViolation = {
	file: string;
	line: number;
	rule: string;
};

type GuardRule = {
	rule: string;
	match: (node: ts.Node, sourceFile: ts.SourceFile, file: string) => ts.Node | undefined;
};

type GuardSource = {
	file: string;
	source: string;
};

const parseSources = async (sources: readonly GuardSource[]) => {
	const entries = sources.map(({ file, source }, index) => ({
		file,
		source,
		path: `${virtualRoot}/${index}${extname(file)}`,
	}));
	const fs = createVirtualFileSystem({
		...Object.fromEntries(entries.map(({ path, source }) => [path, source])),
		[virtualConfigFile]: JSON.stringify({
			files: entries.map(({ path }) => path),
			compilerOptions: {
				types: [],
				noEmit: true,
				noLib: true,
				noResolve: true,
			},
		}),
	});
	const api = new API({ cwd: "/", fs, tsserverPath });

	try {
		const snapshot = await api.updateSnapshot({ openProjects: [virtualConfigFile] });
		const project = snapshot.getProject(virtualConfigFile);
		if (!project) throw new Error("TypeScript did not create the Effect v4 guard project.");

		const parsed: { file: string; sourceFile: ts.SourceFile }[] = [];
		for (const entry of entries) {
			const sourceFile = await project.program.getSourceFile(entry.path);
			if (!sourceFile) throw new Error(`TypeScript did not parse guard source: ${entry.file}`);
			parsed.push({ file: entry.file, sourceFile });
		}
		return parsed;
	} finally {
		await api.close();
	}
};

const moduleSpecifier = (node: ts.Node) => {
	if (ts.isImportDeclaration(node) && ts.isStringLiteralLikeNode(node.moduleSpecifier)) {
		return node.moduleSpecifier;
	}
	if (
		ts.isExportDeclaration(node) &&
		node.moduleSpecifier &&
		ts.isStringLiteralLikeNode(node.moduleSpecifier)
	) {
		return node.moduleSpecifier;
	}
};

const moduleRule = (source: string): GuardRule => ({
	rule: source,
	match: (node) => {
		const specifier = moduleSpecifier(node);
		if (specifier && (specifier.text === source || specifier.text.startsWith(`${source}/`))) {
			return specifier;
		}
	},
});

const propertyRule = (object: string, property: string): GuardRule => ({
	rule: `${object}.${property}`,
	match: (node) => {
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === object &&
			node.name.text === property
		) {
			return node;
		}
		if (
			ts.isQualifiedName(node) &&
			ts.isIdentifier(node.left) &&
			node.left.text === object &&
			node.right.text === property
		) {
			return node;
		}
	},
});

const SCHEMA_SOURCES = new Set([
	"effect",
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/workflow",
]);

const isSchemaSource = (source: string, file: string) =>
	SCHEMA_SOURCES.has(source) || (source === "./effect" && file.startsWith("libs/sandbox-sdk/src/"));

const SCHEMA_ANNOTATION_FACTORIES = new Set(["Struct", "Union", "suspend"]);
const SCHEMA_ANNOTATION_VALUES = new Set(["Boolean", "Number", "String", "Unknown"]);
const SCHEMA_LEGACY_CHECKS = [
	"filter",
	"positive",
	"nonNegative",
	"negative",
	"nonPositive",
	"greaterThan",
	"greaterThanOrEqualTo",
	"lessThan",
	"lessThanOrEqualTo",
	"between",
	"int",
	"multipleOf",
	"finite",
	"minItems",
	"maxItems",
	"minLength",
	"maxLength",
	"length",
	"pattern",
	"nonEmptyString",
] as const;

const hasBindingName = (name: ts.BindingName, local: string): boolean => {
	if (ts.isIdentifier(name)) return name.text === local;
	return name.elements.some(
		(element) => ts.isBindingElement(element) && hasBindingName(element.name, local),
	);
};

const statementBindings = (statement: ts.Statement, local: string): ts.Node[] => {
	if (ts.isImportDeclaration(statement)) {
		const clause = statement.importClause;
		if (!clause) return [];
		const bindings: ts.Node[] = [];
		if (clause.name?.text === local) bindings.push(clause.name);
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
			if (clause.namedBindings.name.text === local) bindings.push(clause.namedBindings);
		} else if (clause.namedBindings) {
			bindings.push(
				...clause.namedBindings.elements.filter((element) => element.name.text === local),
			);
		}
		return bindings;
	}
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.filter((declaration) =>
			hasBindingName(declaration.name, local),
		);
	}
	if (
		(ts.isClassDeclaration(statement) ||
			ts.isFunctionDeclaration(statement) ||
			ts.isEnumDeclaration(statement)) &&
		statement.name?.text === local
	) {
		return [statement];
	}
	return [];
};

const lexicalBinding = (identifier: ts.Identifier, sourceFile: ts.SourceFile) => {
	const local = identifier.text;
	for (let current = identifier.parent; current; current = current.parent) {
		const typeParameters = (current as Partial<ts.DeclarationWithTypeParameters>).typeParameters;
		let bindings: ts.Node[] =
			typeParameters?.filter((parameter) => parameter.name.text === local) ?? [];
		const parameters = (current as Partial<ts.FunctionLikeDeclaration>).parameters;
		if (parameters) {
			bindings.push(...parameters.filter((parameter) => hasBindingName(parameter.name, local)));
		} else if (ts.isCatchClause(current) && current.variableDeclaration) {
			bindings = hasBindingName(current.variableDeclaration.name, local)
				? [current.variableDeclaration]
				: [];
		} else if (
			(ts.isForStatement(current) ||
				ts.isForOfStatement(current) ||
				ts.isForInStatement(current)) &&
			current.initializer &&
			ts.isVariableDeclarationList(current.initializer)
		) {
			bindings = current.initializer.declarations.filter((declaration) =>
				hasBindingName(declaration.name, local),
			);
		} else if (ts.isBlock(current) || ts.isSourceFile(current)) {
			bindings = current.statements.flatMap((statement) => statementBindings(statement, local));
		}
		if (bindings.length) return bindings.length === 1 ? bindings[0] : undefined;
		if (current === sourceFile) return;
	}
};

const importDeclarationFor = (node: ts.Node) => {
	for (let current: ts.Node | undefined = node; current; current = current.parent) {
		if (ts.isImportDeclaration(current)) return current;
	}
};

const bunContextRule: GuardRule = {
	rule: "@effect/platform-bun BunContext",
	match: (node, sourceFile) => {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteralLikeNode(node.moduleSpecifier) &&
			node.moduleSpecifier.text === "@effect/platform-bun" &&
			node.importClause?.namedBindings &&
			ts.isNamedImports(node.importClause.namedBindings)
		) {
			return node.importClause.namedBindings.elements.find(
				(element) => (element.propertyName ?? element.name).text === "BunContext",
			);
		}

		let namespace: ts.Identifier | undefined;
		let member: ts.Identifier | ts.StringLiteralLike | undefined;
		if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
			namespace = node.expression;
			member = node.name;
		} else if (
			ts.isElementAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression)
		) {
			namespace = node.expression;
			member = node.argumentExpression;
		} else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
			namespace = node.left;
			member = node.right;
		}
		if (!namespace || member?.text !== "BunContext") return;

		const binding = lexicalBinding(namespace, sourceFile);
		if (!binding) return;
		const declaration = importDeclarationFor(binding);
		if (
			!declaration ||
			!ts.isStringLiteralLikeNode(declaration.moduleSpecifier) ||
			declaration.moduleSpecifier.text !== "@effect/platform-bun"
		) {
			return;
		}
		if (ts.isNamespaceImport(binding)) return member;
	},
};

const isSchemaImportReference = (
	identifier: ts.Identifier,
	sourceFile: ts.SourceFile,
	file = "",
) => {
	const binding = lexicalBinding(identifier, sourceFile);
	if (!binding || !ts.isImportSpecifier(binding) || binding.isTypeOnly === true) return false;
	const declaration = importDeclarationFor(binding);
	return (
		declaration?.importClause?.isTypeOnly !== true &&
		ts.isStringLiteralLikeNode(declaration.moduleSpecifier) &&
		isSchemaSource(declaration.moduleSpecifier.text, file) &&
		(binding.propertyName ?? binding.name).text === "Schema"
	);
};

const isStrictStructImportReference = (
	identifier: ts.Identifier,
	sourceFile: ts.SourceFile,
	file: string,
) => {
	const binding = lexicalBinding(identifier, sourceFile);
	if (!binding || !ts.isImportSpecifier(binding) || binding.isTypeOnly === true) return false;
	const declaration = importDeclarationFor(binding);
	return (
		declaration?.importClause?.isTypeOnly !== true &&
		ts.isStringLiteralLikeNode(declaration.moduleSpecifier) &&
		resolve("/", dirname(file), declaration.moduleSpecifier.text) ===
			"/libs/contract/src/schema/utils" &&
		(binding.propertyName ?? binding.name).text === "strictStruct"
	);
};

const isOwnedSchemaExpression = (
	node: ts.Expression,
	sourceFile: ts.SourceFile,
	file: string,
	seen = new Set<ts.Node>(),
): boolean => {
	if (seen.has(node)) return false;
	seen.add(node);

	if (ts.isIdentifier(node)) {
		const declaration = lexicalBinding(node, sourceFile);
		return (
			declaration !== undefined &&
			ts.isVariableDeclaration(declaration) &&
			ts.isIdentifier(declaration.name) &&
			declaration.initializer !== undefined &&
			(declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
			isOwnedSchemaExpression(declaration.initializer, sourceFile, file, seen)
		);
	}
	if (
		ts.isPropertyAccessExpression(node) &&
		ts.isIdentifier(node.expression) &&
		SCHEMA_ANNOTATION_VALUES.has(node.name.text)
	) {
		return isSchemaImportReference(node.expression, sourceFile, file);
	}
	if (!ts.isCallExpression(node)) return false;
	if (ts.isIdentifier(node.expression)) {
		return isStrictStructImportReference(node.expression, sourceFile, file);
	}
	if (!ts.isPropertyAccessExpression(node.expression)) return false;
	if (
		ts.isIdentifier(node.expression.expression) &&
		SCHEMA_ANNOTATION_FACTORIES.has(node.expression.name.text)
	) {
		return isSchemaImportReference(node.expression.expression, sourceFile, file);
	}
	return (
		node.expression.name.text === "pipe" &&
		isOwnedSchemaExpression(node.expression.expression, sourceFile, file, seen)
	);
};

const schemaAnnotationRule: GuardRule = {
	rule: "Schema.annotations",
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === "annotations") {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === "annotations"
		) {
			expression = node.expression;
		}
		if (!expression) return;
		if (ts.isIdentifier(expression)) {
			return isSchemaImportReference(expression, sourceFile, file) ||
				isOwnedSchemaExpression(expression, sourceFile, file)
				? node
				: undefined;
		}
		return isOwnedSchemaExpression(expression, sourceFile, file) ? node : undefined;
	},
};

const schemaConstructorRule = (
	property: "Literal" | "Record" | "Union",
	legacyShape: (node: ts.CallExpression) => boolean,
): GuardRule => ({
	rule: `Schema.${property} legacy arguments`,
	match: (node, sourceFile, file) => {
		if (
			!ts.isCallExpression(node) ||
			!ts.isPropertyAccessExpression(node.expression) ||
			node.expression.name.text !== property ||
			!ts.isIdentifier(node.expression.expression) ||
			!isSchemaImportReference(node.expression.expression, sourceFile, file) ||
			!legacyShape(node)
		) {
			return;
		}
		return node.expression;
	},
});

const schemaTupleRule: GuardRule = {
	rule: "Schema.Tuple legacy arguments",
	match: (node, sourceFile, file) => {
		if (!ts.isCallExpression(node)) return;

		let schema: ts.Identifier | undefined;
		let unsupportedSyntax = node.questionDotToken !== undefined;
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "Tuple" &&
			ts.isIdentifier(node.expression.expression)
		) {
			schema = node.expression.expression;
			unsupportedSyntax ||= node.expression.questionDotToken !== undefined;
		} else if (
			ts.isElementAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.argumentExpression &&
			ts.isStringLiteralLikeNode(node.expression.argumentExpression) &&
			node.expression.argumentExpression.text === "Tuple"
		) {
			schema = node.expression.expression;
			unsupportedSyntax = true;
		}
		if (!schema || !isSchemaImportReference(schema, sourceFile, file)) return;

		if (
			unsupportedSyntax ||
			(node.typeArguments?.length ?? 0) > 0 ||
			node.arguments.length !== 1 ||
			!ts.isArrayLiteralExpression(node.arguments[0])
		) {
			return node.expression;
		}
	},
};

const schemaCodecRule = (
	property: "decodeUnknown" | "decodeUnknownEither" | "parseJson",
): GuardRule => ({
	rule: `Schema.${property}`,
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === property) {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === property
		) {
			expression = node.expression;
		}
		if (
			!expression ||
			!ts.isIdentifier(expression) ||
			!isSchemaImportReference(expression, sourceFile, file)
		) {
			return;
		}
		return node;
	},
});

const schemaCheckRule = (property: (typeof SCHEMA_LEGACY_CHECKS)[number]): GuardRule => ({
	rule: `Schema.${property}`,
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === property) {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === property
		) {
			expression = node.expression;
		}
		if (
			!expression ||
			!ts.isIdentifier(expression) ||
			!isSchemaImportReference(expression, sourceFile, file)
		) {
			return;
		}
		return node;
	},
});

const schemaTaggedErrorRule: GuardRule = {
	rule: "Schema.TaggedError",
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === "TaggedError") {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === "TaggedError"
		) {
			expression = node.expression;
		}
		if (
			!expression ||
			!ts.isIdentifier(expression) ||
			!isSchemaImportReference(expression, sourceFile, file)
		) {
			return;
		}
		return node;
	},
};

const schemaOptionalRule = (property: "optionalElement" | "optionalWith"): GuardRule => ({
	rule: `Schema.${property}`,
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === property) {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === property
		) {
			expression = node.expression;
		}
		if (
			!expression ||
			!ts.isIdentifier(expression) ||
			!isSchemaImportReference(expression, sourceFile, file)
		) {
			return;
		}
		return node;
	},
});

const schemaTransformationRule = (property: "compose" | "transform"): GuardRule => ({
	rule: `Schema.${property}`,
	match: (node, sourceFile, file) => {
		let expression: ts.Expression | undefined;
		if (ts.isPropertyAccessExpression(node) && node.name.text === property) {
			expression = node.expression;
		} else if (
			ts.isElementAccessExpression(node) &&
			node.argumentExpression &&
			ts.isStringLiteralLikeNode(node.argumentExpression) &&
			node.argumentExpression.text === property
		) {
			expression = node.expression;
		}
		if (
			!expression ||
			!ts.isIdentifier(expression) ||
			!isSchemaImportReference(expression, sourceFile, file)
		) {
			return;
		}
		return node;
	},
});

const namedParseResult = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
	elements.find((element) => (element.propertyName ?? element.name).text === "ParseResult");

const parseResultRule: GuardRule = {
	rule: "ParseResult import",
	match: (node) => {
		const specifier = moduleSpecifier(node);
		if (!specifier) return;
		if (
			specifier.text === "effect/ParseResult" ||
			specifier.text.startsWith("effect/ParseResult/")
		) {
			return specifier;
		}
		if (specifier.text !== "effect" && specifier.text !== "@ryot/sandbox-sdk/effect") return;

		if (ts.isImportDeclaration(node)) {
			const clause = node.importClause;
			if (clause?.name?.text === "ParseResult") return clause.name;
			if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
				return clause.namedBindings.name.text === "ParseResult" ? clause.namedBindings : undefined;
			}
			if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				return namedParseResult(clause.namedBindings.elements);
			}
		}

		if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
			return namedParseResult(node.exportClause.elements);
		}
	},
};

const testClockImportRule: GuardRule = {
	rule: "TestClock import",
	match: (node) => {
		if (!ts.isImportDeclaration(node)) return;
		const specifier = moduleSpecifier(node);
		if (specifier?.text !== "effect") return;

		const bindings = node.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) return;
		return bindings.elements.find(
			(element) => (element.propertyName ?? element.name).text === "TestClock",
		);
	},
};

const layerContextRule: GuardRule = {
	rule: "Layer.Layer.Context",
	match: (node) => {
		if (
			ts.isQualifiedName(node) &&
			ts.isQualifiedName(node.left) &&
			ts.isIdentifier(node.left.left) &&
			node.left.left.text === "Layer" &&
			node.left.right.text === "Layer" &&
			node.right.text === "Context"
		) {
			return node;
		}
	},
};

const effectTypeExtractorRule = (extractor: string): GuardRule => ({
	rule: `Effect.Effect.${extractor}`,
	match: (node) => {
		if (
			ts.isQualifiedName(node) &&
			ts.isQualifiedName(node.left) &&
			ts.isIdentifier(node.left.left) &&
			node.left.left.text === "Effect" &&
			node.left.right.text === "Effect" &&
			node.right.text === extractor
		) {
			return node;
		}
	},
});

export const GUARD_RULES: readonly GuardRule[] = [
	bunContextRule,
	moduleRule("@effect/platform"),
	moduleRule("@effect/workflow"),
	moduleRule("@effect/cluster"),
	moduleRule("@effect/experimental"),
	moduleRule("@effect-atom/atom-react"),
	propertyRule("LogLevel", "All"),
	propertyRule("LogLevel", "Debug"),
	propertyRule("LogLevel", "Error"),
	propertyRule("LogLevel", "Fatal"),
	propertyRule("LogLevel", "Info"),
	propertyRule("LogLevel", "None"),
	propertyRule("LogLevel", "Trace"),
	propertyRule("LogLevel", "Warning"),
	propertyRule("LogLevel", "lessThanEqual"),
	propertyRule("Logger", "logfmtLogger"),
	propertyRule("Logger", "minimumLogLevel"),
	propertyRule("Logger", "prettyLogger"),
	propertyRule("Logger", "replace"),
	propertyRule("Logger", "replaceScoped"),
	propertyRule("Logger", "zip"),
	propertyRule("Effect", "Service"),
	propertyRule("Effect", "either"),
	propertyRule("Effect", "catchAll"),
	propertyRule("Effect", "catchAllCause"),
	propertyRule("Effect", "zipRight"),
	propertyRule("Effect", "fork"),
	propertyRule("Effect", "tapErrorCause"),
	propertyRule("Effect", "dieMessage"),
	propertyRule("Effect", "ignoreLogged"),
	propertyRule("Effect", "mapInputContext"),
	propertyRule("Effect", "timeoutFail"),
	propertyRule("Effect", "orElse"),
	propertyRule("Effect", "makeSemaphore"),
	propertyRule("Effect", "Semaphore"),
	propertyRule("Effect", "optionFromOptional"),
	propertyRule("Effect", "unsandbox"),
	propertyRule("Effect", "runtime"),
	effectTypeExtractorRule("Success"),
	effectTypeExtractorRule("Error"),
	propertyRule("Stream", "as"),
	propertyRule("Runtime", "Runtime"),
	propertyRule("Runtime", "runPromise"),
	propertyRule("Runtime", "runPromiseExit"),
	propertyRule("Runtime", "runFork"),
	propertyRule("Fiber", "interruptFork"),
	propertyRule("Cause", "failureOption"),
	propertyRule("Cause", "isInterrupted"),
	propertyRule("Cause", "isInterruptedOnly"),
	propertyRule("Exit", "isInterrupted"),
	propertyRule("Context", "unsafeMake"),
	propertyRule("DateTime", "lessThan"),
	propertyRule("DateTime", "unsafeFromDate"),
	propertyRule("DateTime", "unsafeMake"),
	propertyRule("DateTime", "unsafeNow"),
	propertyRule("Deferred", "unsafeDone"),
	propertyRule("Option", "fromNullable"),
	propertyRule("Scope", "extend"),
	propertyRule("Layer", "scopedDiscard"),
	propertyRule("Layer", "unwrapEffect"),
	propertyRule("Layer", "scoped"),
	propertyRule("it", "scoped"),
	propertyRule("it", "scopedLive"),
	testClockImportRule,
	parseResultRule,
	layerContextRule,
	schemaConstructorRule(
		"Literal",
		(node) => node.arguments.length >= 2 || node.arguments.some(ts.isSpreadElement),
	),
	schemaConstructorRule(
		"Union",
		(node) => node.arguments.length === 0 || !ts.isArrayLiteralExpression(node.arguments[0]),
	),
	schemaConstructorRule(
		"Record",
		(node) => node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0]),
	),
	schemaTupleRule,
	schemaCodecRule("decodeUnknown"),
	schemaCodecRule("decodeUnknownEither"),
	schemaCodecRule("parseJson"),
	...SCHEMA_LEGACY_CHECKS.map(schemaCheckRule),
	schemaTaggedErrorRule,
	schemaOptionalRule("optionalElement"),
	schemaOptionalRule("optionalWith"),
	schemaTransformationRule("compose"),
	schemaTransformationRule("transform"),
	schemaAnnotationRule,
];

const scanSourceFile = (file: string, sourceFile: ts.SourceFile) => {
	const violations: GuardViolation[] = [];

	const visit = (node: ts.Node) => {
		for (const rule of GUARD_RULES) {
			const match = rule.match(node, sourceFile, file);
			if (!match) continue;
			const location = sourceFile.getLineAndCharacterOfPosition(match.getStart(sourceFile));
			violations.push({ file, line: location.line + 1, rule: rule.rule });
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);

	return violations.sort(
		(left, right) => left.line - right.line || left.rule.localeCompare(right.rule),
	);
};

export const scanSource = async (file: string, source: string) => {
	const [parsed] = await parseSources([{ file, source }]);
	if (!parsed) throw new Error(`TypeScript did not parse guard source: ${file}`);
	return scanSourceFile(parsed.file, parsed.sourceFile);
};

export const formatViolation = ({ file, line, rule }: GuardViolation) => `${file}:${line}: ${rule}`;

export const scanFiles = async (files: readonly string[], rootDir = REPOSITORY_ROOT) => {
	const sources = await Promise.all(
		files.map(async (file) => ({
			file: toRepositoryPath(rootDir, file),
			source: await readFile(file, "utf8"),
		})),
	);
	const parsed = await parseSources(sources);
	return parsed.flatMap(({ file, sourceFile }) => scanSourceFile(file, sourceFile));
};

export const runGuard = async (rootDir = REPOSITORY_ROOT) => {
	const files = await discoverSourceFiles(rootDir);
	const violations = await scanFiles(files, rootDir);
	for (const violation of violations) console.error(formatViolation(violation));

	if (violations.length) {
		console.error(
			`Effect v4 guard found ${violations.length} violation(s) in ${files.length} file(s).`,
		);
		return 1;
	}

	console.log(`Effect v4 guard checked ${files.length} file(s); no violations found.`);
	return 0;
};

if (import.meta.main) {
	try {
		process.exitCode = await runGuard();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
