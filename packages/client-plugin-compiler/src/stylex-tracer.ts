import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import { parseSync, transformSync } from "@babel/core";
// @ts-ignore -- Babel publishes no declarations for this syntax-only plugin.
import syntaxJsx from "@babel/plugin-syntax-jsx";
// @ts-ignore -- Babel publishes no declarations for this syntax-only plugin.
import syntaxTypeScript from "@babel/plugin-syntax-typescript";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import stylexPlugin, { type Rule } from "@stylexjs/babel-plugin";

import { type ClientPluginCompilerDiagnostic, clientPluginCompilerDiagnostic } from "./diagnostics";
import type { ClientCompilerBenchmarkInstrumentation } from "./instrumentation";

export type StylexTracerRule = Rule;

const STYLEX_TRACER_MODULE = "@ryot-app/client-ui-sdk/stylex-tracer";
const STYLEX_TRACER_TOKENS_MODULE = "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
export const STYLEX_TRACER_OVERLAY_MODULE = "@ryot-app/client-ui-sdk/overlay";
export const STYLEX_TRACER_SHORTCUT_MODULE = "@ryot-app/client-ui-sdk/shortcut";
export const STYLEX_RUNTIME_MODULE = "@stylexjs/stylex";

export const STYLEX_TRACER_TRUSTED_MODULES = [
	STYLEX_TRACER_MODULE,
	STYLEX_TRACER_TOKENS_MODULE,
	STYLEX_TRACER_OVERLAY_MODULE,
	STYLEX_TRACER_SHORTCUT_MODULE,
] as const;

const tracerReset = `@layer ryot-tracer-reset {
	*, *::before, *::after { box-sizing: border-box; }
	html, body { height: 100%; margin: 0; overflow: hidden; }
	body { font-family: "Outfit Variable", sans-serif; }
	button, input { font: inherit; }
	#app { height: 100%; isolation: isolate; overflow: hidden; position: relative; }
}`;

const stylexOptions = {
	dev: false,
	test: false,
	runtimeInjection: false,
	treeshakeCompensation: true,
	importSources: [STYLEX_RUNTIME_MODULE],
	propertyValidationMode: "throw" as const,
	styleResolution: "property-specificity" as const,
};

const tracerAdapterIdentity = JSON.stringify({
	stylexOptions,
	babel: "7.29.0",
	stylex: "0.19.0",
	reset: tracerReset,
	stylexBabelPlugin: "0.19.0",
	moduleResolution: "bounded-custom-v1",
	fonts: ["@fontsource-variable/lora@5.3.0", "@fontsource-variable/outfit@5.3.0"],
});

type FingerprintInput = readonly [id: string, contentHash: string];

export const deriveStylexTracerBuildFingerprint = (inputs: readonly FingerprintInput[]) =>
	sha256Hex(
		new TextEncoder().encode(
			JSON.stringify(sortBy(inputs, ([id]) => id).map(([id, contentHash]) => [id, contentHash])),
		),
	);

const fingerprintFiles = (label: string, root: string, pattern: string) =>
	sortBy([...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })])
		.filter((path) => !/\.(?:test|spec)\./.test(path))
		.map(
			(path): FingerprintInput => [
				`${label}/${path}`,
				sha256Hex(new Uint8Array(readFileSync(join(root, path)))),
			],
		);

const fingerprintFile = (id: string, path: string): FingerprintInput => [
	id,
	sha256Hex(new Uint8Array(readFileSync(path))),
];

const resolveTrustedStylexSourceSet = (compilerRoot: string) => {
	const entries = Object.fromEntries(
		STYLEX_TRACER_TRUSTED_MODULES.map((specifier) => [
			specifier,
			Bun.resolveSync(specifier, compilerRoot),
		]),
	);
	const tracerRoot = dirname(entries[STYLEX_TRACER_MODULE] ?? "");
	const paths = new Set(
		[...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: tracerRoot, onlyFiles: true })]
			.filter((path) => !/\.(?:test|spec)\./.test(path))
			.map((path) => join(tracerRoot, path)),
	);
	for (const specifier of [STYLEX_TRACER_OVERLAY_MODULE, STYLEX_TRACER_SHORTCUT_MODULE]) {
		const path = entries[specifier];
		if (path !== undefined) {
			paths.add(path);
		}
	}
	return { entries, tracerRoot, paths: sortBy([...paths]) };
};

const startupCompilerRoot = dirname(Bun.fileURLToPath(import.meta.url));
const startupTrustedStylexSourceHashes = new Map(
	resolveTrustedStylexSourceSet(startupCompilerRoot).paths.map((path) => [
		path,
		sha256Hex(new Uint8Array(readFileSync(path))),
	]),
);

const packageFingerprintInputs = (specifier: string, compilerRoot: string) => {
	const root = dirname(Bun.resolveSync(`${specifier}/package.json`, compilerRoot));
	return fingerprintFiles(
		specifier,
		root,
		"{package.json,lib/**/*.{js,mjs,cjs,json},dist/**/*.{js,mjs,cjs,json}}",
	);
};

const tracerCompilerSourceInputs = (compilerPackageRoot: string) =>
	[
		"artifact.ts",
		"bundle.ts",
		"compile.ts",
		"dependencies.ts",
		"diagnostics.ts",
		"import-policy.ts",
		"limits.ts",
		"protocol.ts",
		"semantic-check.ts",
		"source-imports.ts",
		"stylex-tracer.ts",
	].map((path) =>
		fingerprintFile(
			`@ryot-app/client-plugin-compiler/src/${path}`,
			join(compilerPackageRoot, "src", path),
		),
	);

const tracerDependencyInputs = () => {
	const compilerRoot = dirname(Bun.fileURLToPath(import.meta.url));
	const compilerPackageRoot = resolve(compilerRoot, "..");
	const clientSdkRoot = dirname(Bun.resolveSync("@ryot-app/client-sdk", compilerRoot));
	const uiSdkRoot = dirname(Bun.resolveSync("@ryot-app/client-ui-sdk", compilerRoot));
	const packageInputs = [
		"@babel/core",
		"@babel/plugin-syntax-jsx",
		"@babel/plugin-syntax-typescript",
		"@stylexjs/babel-plugin",
		"@stylexjs/stylex",
		"@tanstack/hotkeys",
		"@tanstack/react-hotkeys",
		"@tanstack/store",
		"effect",
		"react",
		"react-dom",
	].flatMap((specifier) => packageFingerprintInputs(specifier, compilerRoot));
	const fontInputs = ["@fontsource-variable/lora", "@fontsource-variable/outfit"].flatMap(
		(specifier) => {
			const entry = Bun.resolveSync(specifier, compilerRoot);
			return fingerprintFiles(specifier, dirname(entry), "{index.css,files/*.woff2}");
		},
	);
	return [
		["adapter", sha256Hex(new TextEncoder().encode(tracerAdapterIdentity))] as const,
		[
			"runtime/bun",
			sha256Hex(
				new TextEncoder().encode(JSON.stringify({ version: Bun.version, revision: Bun.revision })),
			),
		] as const,
		fingerprintFile("bun.lock", resolve(compilerRoot, "../../../bun.lock")),
		...tracerCompilerSourceInputs(compilerPackageRoot),
		fingerprintFile(
			"@ryot-app/client-sdk/package.json",
			resolve(compilerRoot, "../../client-sdk/package.json"),
		),
		fingerprintFile(
			"@ryot-app/client-ui-sdk/package.json",
			resolve(compilerRoot, "../../client-ui-sdk/package.json"),
		),
		...fingerprintFiles("@ryot-app/client-sdk", clientSdkRoot, "**/*.{ts,tsx,js,jsx}"),
		...fingerprintFiles("@ryot-app/client-ui-sdk", uiSdkRoot, "**/*.{ts,tsx,js,jsx}"),
		...fingerprintFiles(
			"@ryot-app/client-plugin-contract",
			resolve(compilerRoot, "../../client-plugin-contract/src"),
			"**/*.{ts,tsx,js,jsx}",
		),
		...fingerprintFiles(
			"@ryot-app/contract",
			resolve(compilerRoot, "../../contract/src"),
			"**/*.{ts,tsx,js,jsx}",
		),
		...fingerprintFiles(
			"@ryot-app/ryotql",
			resolve(compilerRoot, "../../ryotql/src"),
			"**/*.{ts,tsx,js,jsx}",
		),
		...packageInputs,
		...fontInputs,
	];
};

export const STYLEX_TRACER_BUILD_FINGERPRINT =
	deriveStylexTracerBuildFingerprint(tracerDependencyInputs());

type TrustedStylexSource = {
	readonly actualPath: string;
	readonly logicalPath: string;
	readonly source: string;
};

type StylexTracerBundleAdapter = {
	readonly rules: Rule[];
	readonly preflightDiagnostics: readonly ClientPluginCompilerDiagnostic[];
	readonly trustedEntries: Readonly<Record<string, string>>;
	readonly trustedSources: Readonly<Record<string, TrustedStylexSource>>;
	readonly archivedPaths: Readonly<Record<string, string>>;
	readonly cleanup: () => void;
	readonly resolveTrustedImport: (importer: string, specifier: string) => string | undefined;
	readonly transform: (
		logicalPath: string,
		source: string,
		actualPath: string,
	) => { readonly code?: string; readonly diagnostic?: ClientPluginCompilerDiagnostic };
};

const sourceLoaderExtension = (path: string) => (path.endsWith(".tsx") ? ".tsx" : ".ts");

const nodeType = (value: object) =>
	"type" in value && typeof value.type === "string" ? value.type : undefined;

const sourcePosition = (value: object) => {
	const location = "loc" in value ? value.loc : undefined;
	const start =
		typeof location === "object" && location !== null && "start" in location
			? location.start
			: undefined;
	return {
		line:
			typeof start === "object" &&
			start !== null &&
			"line" in start &&
			typeof start.line === "number"
				? start.line
				: 1,
		column:
			typeof start === "object" &&
			start !== null &&
			"column" in start &&
			typeof start.column === "number"
				? start.column + 1
				: 1,
	};
};

const childNode = (value: object, key: string) => {
	const child = Reflect.get(value, key);
	return typeof child === "object" && child !== null ? child : undefined;
};

const identifierName = (value: object | undefined) =>
	value !== undefined && nodeType(value) === "Identifier" && "name" in value
		? String(value.name)
		: undefined;

const isCssPropertiesType = (value: object | undefined, stylexBindings: ReadonlySet<string>) => {
	if (value === undefined || nodeType(value) !== "TSTypeReference") {
		return false;
	}
	const typeName = childNode(value, "typeName");
	if (typeName === undefined || nodeType(typeName) !== "TSQualifiedName") {
		return false;
	}
	return (
		stylexBindings.has(identifierName(childNode(typeName, "left")) ?? "") &&
		identifierName(childNode(typeName, "right")) === "CSSProperties"
	);
};

const isCheckedDeclaration = (value: object, stylexBindings: ReadonlySet<string>) =>
	nodeType(value) === "TSSatisfiesExpression" &&
	nodeType(childNode(value, "expression") ?? {}) === "ObjectExpression" &&
	isCssPropertiesType(childNode(value, "typeAnnotation"), stylexBindings);

const propertyName = (property: object) => {
	const key = childNode(property, "key");
	if (key === undefined) {
		return undefined;
	}
	if (nodeType(key) === "Identifier") {
		return identifierName(key);
	}
	const value = Reflect.get(key, "value");
	return typeof value === "string" ? value : undefined;
};

const isCheckedConditionalWrapper = (value: object, stylexBindings: ReadonlySet<string>) => {
	if (nodeType(value) !== "ObjectExpression" || !("properties" in value)) {
		return false;
	}
	const properties = Array.isArray(value.properties) ? value.properties : [];
	return (
		properties.length > 0 &&
		properties.every((property) => {
			if (
				typeof property !== "object" ||
				property === null ||
				nodeType(property) !== "ObjectProperty"
			) {
				return false;
			}
			const name = propertyName(property);
			const declaration = childNode(property, "value");
			return (
				(name?.startsWith(":") === true || name?.startsWith("@") === true) &&
				declaration !== undefined &&
				isCheckedDeclaration(declaration, stylexBindings)
			);
		})
	);
};

const hasCheckedDynamicReturn = (value: object, stylexBindings: ReadonlySet<string>) => {
	if (nodeType(value) !== "ArrowFunctionExpression" && nodeType(value) !== "FunctionExpression") {
		return false;
	}
	const returnType = childNode(value, "returnType");
	return (
		returnType !== undefined &&
		nodeType(returnType) === "TSTypeAnnotation" &&
		isCssPropertiesType(childNode(returnType, "typeAnnotation"), stylexBindings)
	);
};

const stylexConventionDiagnostic = (logicalPath: string, value: object) => ({
	...clientPluginCompilerDiagnostic(
		"RYOT_CLIENT_STYLEX_CONVENTION",
		logicalPath,
		"StyleX must use a namespace import and direct noncomputed `stylex.create({ ... })`; static declarations use `satisfies stylex.CSSProperties`, condition wrappers check each declaration leaf, and dynamic styles declare a `stylex.CSSProperties` return type",
	),
	...sourcePosition(value),
});

const AST_WALK_LIMIT = 100_000;
const AST_WALK_SKIPPED_KEYS = new Set([
	"comments",
	"end",
	"extra",
	"innerComments",
	"leadingComments",
	"loc",
	"parent",
	"start",
	"tokens",
	"trailingComments",
]);
const AST_WALK_LIMIT_REACHED = Symbol("AST_WALK_LIMIT_REACHED");

type AstVisit = { readonly key?: string; readonly node: object; readonly parent?: object };

const walkAst = <T>(root: unknown, visit: (entry: AstVisit) => T | undefined) => {
	if (typeof root !== "object" || root === null) {
		return undefined;
	}
	const stack: AstVisit[] = [{ node: root }];
	const seen = new WeakSet<object>();
	let visited = 0;
	while (stack.length > 0) {
		const entry = stack.pop();
		if (entry === undefined || seen.has(entry.node)) {
			continue;
		}
		seen.add(entry.node);
		visited += 1;
		if (visited > AST_WALK_LIMIT) {
			return AST_WALK_LIMIT_REACHED;
		}
		const result = visit(entry);
		if (result !== undefined) {
			return result;
		}
		const children = Object.entries(entry.node).filter(([key]) => !AST_WALK_SKIPPED_KEYS.has(key));
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const childEntry = children[index];
			if (childEntry === undefined) {
				continue;
			}
			const [key, child] = childEntry;
			if (Array.isArray(child)) {
				for (let childIndex = child.length - 1; childIndex >= 0; childIndex -= 1) {
					const item = child[childIndex];
					if (typeof item === "object" && item !== null) {
						stack.push({ key, node: item, parent: entry.node });
					}
				}
			} else if (typeof child === "object" && child !== null) {
				stack.push({ key, node: child, parent: entry.node });
			}
		}
	}
	return undefined;
};

const stringLiteralValue = (value: object | undefined) => {
	if (value === undefined || nodeType(value) !== "StringLiteral") {
		return undefined;
	}
	const literal = Reflect.get(value, "value");
	return typeof literal === "string" ? literal : undefined;
};

const isStylexModuleReference = (value: object | undefined) =>
	stringLiteralValue(value) === STYLEX_RUNTIME_MODULE;

const createPropertyName = (member: object) => {
	const property = childNode(member, "property");
	return identifierName(property) ?? stringLiteralValue(property);
};

export const validateStylexAuthoringConvention = (logicalPath: string, source: string) => {
	const parsed = parseSync(source, {
		babelrc: false,
		configFile: false,
		filename: logicalPath,
		parserOpts: {
			sourceType: "module",
			plugins: [
				["typescript", { dts: logicalPath.endsWith(".d.ts") }],
				...(logicalPath.endsWith(".tsx") ? (["jsx"] as const) : []),
			],
		},
	});
	const stylexBindings = new Set<string>();
	const importDiagnostic = walkAst(parsed, ({ node }) => {
		const type = nodeType(node);
		const sourceNode = childNode(node, "source");
		if (
			(type === "ExportAllDeclaration" || type === "ExportNamedDeclaration") &&
			isStylexModuleReference(sourceNode)
		) {
			return stylexConventionDiagnostic(logicalPath, sourceNode ?? node);
		}
		if (type === "ImportDeclaration" && isStylexModuleReference(sourceNode)) {
			const specifiers = Reflect.get(node, "specifiers");
			const specifier = Array.isArray(specifiers) ? specifiers[0] : undefined;
			if (
				!Array.isArray(specifiers) ||
				specifiers.length !== 1 ||
				typeof specifier !== "object" ||
				specifier === null ||
				nodeType(specifier) !== "ImportNamespaceSpecifier" ||
				Reflect.get(node, "importKind") === "type"
			) {
				return stylexConventionDiagnostic(
					logicalPath,
					typeof specifier === "object" && specifier !== null ? specifier : node,
				);
			}
			const local = identifierName(childNode(specifier, "local"));
			if (local === undefined) {
				return stylexConventionDiagnostic(logicalPath, specifier);
			}
			stylexBindings.add(local);
		}
		if (type === "ImportExpression" && isStylexModuleReference(sourceNode)) {
			return stylexConventionDiagnostic(logicalPath, node);
		}
		if (type === "CallExpression") {
			const callee = childNode(node, "callee");
			const argumentsValue = Reflect.get(node, "arguments");
			const firstArgument = Array.isArray(argumentsValue) ? argumentsValue[0] : undefined;
			if (
				(callee !== undefined && nodeType(callee) === "Import") ||
				identifierName(callee) === "require"
			) {
				if (
					typeof firstArgument === "object" &&
					firstArgument !== null &&
					isStylexModuleReference(firstArgument)
				) {
					return stylexConventionDiagnostic(logicalPath, node);
				}
			}
		}
		if (type === "TSImportEqualsDeclaration") {
			const moduleReference = childNode(node, "moduleReference");
			if (
				moduleReference !== undefined &&
				isStylexModuleReference(childNode(moduleReference, "expression"))
			) {
				return stylexConventionDiagnostic(logicalPath, node);
			}
		}
		return undefined;
	});
	if (importDiagnostic === AST_WALK_LIMIT_REACHED) {
		return stylexConventionDiagnostic(logicalPath, parsed ?? {});
	}
	if (importDiagnostic !== undefined) {
		return importDiagnostic;
	}

	const createDiagnostic = walkAst(parsed, ({ key, node, parent }) => {
		const type = nodeType(node);
		if (
			type === "TSQualifiedName" &&
			stylexBindings.has(identifierName(childNode(node, "left")) ?? "") &&
			identifierName(childNode(node, "right")) === "create"
		) {
			return stylexConventionDiagnostic(logicalPath, node);
		}
		if (type === "Identifier" && stylexBindings.has(identifierName(node) ?? "")) {
			const parentType = parent === undefined ? undefined : nodeType(parent);
			const isImportBinding = parentType === "ImportNamespaceSpecifier" && key === "local";
			const isMemberObject =
				(parentType === "MemberExpression" || parentType === "OptionalMemberExpression") &&
				key === "object";
			const isQualifiedType = parentType === "TSQualifiedName" && key === "left";
			if (!isImportBinding && !isMemberObject && !isQualifiedType) {
				return stylexConventionDiagnostic(logicalPath, node);
			}
		}
		if (type !== "MemberExpression" && type !== "OptionalMemberExpression") {
			return undefined;
		}
		if (!stylexBindings.has(identifierName(childNode(node, "object")) ?? "")) {
			return undefined;
		}
		const computed = Reflect.get(node, "computed") === true;
		const optional = type === "OptionalMemberExpression" || Reflect.get(node, "optional") === true;
		const property = createPropertyName(node);
		if ((computed || optional) && (property === "create" || computed)) {
			return stylexConventionDiagnostic(logicalPath, node);
		}
		if (property !== "create") {
			return undefined;
		}
		if (
			parent === undefined ||
			nodeType(parent) !== "CallExpression" ||
			key !== "callee" ||
			Reflect.get(parent, "optional") === true
		) {
			return stylexConventionDiagnostic(logicalPath, node);
		}
		const argumentsValue = Reflect.get(parent, "arguments");
		if (!Array.isArray(argumentsValue) || argumentsValue.length !== 1) {
			return stylexConventionDiagnostic(logicalPath, parent);
		}
		const definitions = argumentsValue[0];
		if (
			typeof definitions !== "object" ||
			definitions === null ||
			nodeType(definitions) !== "ObjectExpression"
		) {
			return stylexConventionDiagnostic(logicalPath, parent);
		}
		const properties = Reflect.get(definitions, "properties");
		if (!Array.isArray(properties)) {
			return stylexConventionDiagnostic(logicalPath, definitions);
		}
		for (const propertyNode of properties) {
			if (
				typeof propertyNode !== "object" ||
				propertyNode === null ||
				nodeType(propertyNode) !== "ObjectProperty"
			) {
				return stylexConventionDiagnostic(logicalPath, definitions);
			}
			const declaration = childNode(propertyNode, "value");
			if (
				declaration === undefined ||
				(!isCheckedDeclaration(declaration, stylexBindings) &&
					!isCheckedConditionalWrapper(declaration, stylexBindings) &&
					!hasCheckedDynamicReturn(declaration, stylexBindings))
			) {
				return stylexConventionDiagnostic(logicalPath, declaration ?? propertyNode);
			}
		}
		return undefined;
	});
	return createDiagnostic === AST_WALK_LIMIT_REACHED
		? stylexConventionDiagnostic(logicalPath, parsed ?? {})
		: createDiagnostic;
};

const resolveSourceCandidate = (
	base: string,
	specifier: string,
	sources: Readonly<Record<string, unknown>>,
) => {
	const unresolved = resolve(dirname(base), specifier);
	for (const candidate of [
		unresolved,
		`${unresolved}.tsx`,
		`${unresolved}.ts`,
		join(unresolved, "index.tsx"),
		join(unresolved, "index.ts"),
	]) {
		if (Object.hasOwn(sources, candidate)) {
			return candidate;
		}
	}
	return undefined;
};

const diagnosticFromBabelError = (logicalPath: string, actualPath: string, error: unknown) => {
	const directLine =
		error instanceof Error && "line" in error && typeof error.line === "number"
			? error.line
			: undefined;
	const directColumn =
		error instanceof Error && "column" in error && typeof error.column === "number"
			? error.column
			: undefined;
	const location = error instanceof Error && "loc" in error ? error.loc : undefined;
	const locationLine =
		typeof location === "object" &&
		location !== null &&
		"line" in location &&
		typeof location.line === "number"
			? location.line
			: undefined;
	const locationColumn =
		typeof location === "object" &&
		location !== null &&
		"column" in location &&
		typeof location.column === "number"
			? location.column
			: undefined;
	const message =
		error instanceof Error ? error.message.replace(`${actualPath}: `, "") : String(error);
	const frame = /\n>\s*(\d+)\s*\|[^\n]*\n\s*\|\s( *)\^/.exec(message);
	const frameLine = frame?.[1] === undefined ? undefined : Number(frame[1]);
	const frameColumn = frame?.[2] === undefined ? undefined : frame[2].length + 1;
	return {
		...clientPluginCompilerDiagnostic(
			"RYOT_CLIENT_STYLEX",
			logicalPath,
			`StyleX transform failed: ${message}`,
		),
		line: Math.max(1, locationLine ?? frameLine ?? directLine ?? 1),
		column: Math.max(
			1,
			(locationColumn ?? (frameColumn === undefined ? directColumn : frameColumn - 1) ?? 0) + 1,
		),
	};
};

const isStylexRule = (value: unknown): value is Rule =>
	Array.isArray(value) &&
	typeof value[0] === "string" &&
	typeof value[1] === "object" &&
	value[1] !== null &&
	"ltr" in value[1] &&
	typeof value[1].ltr === "string" &&
	typeof value[2] === "number";

const trustedLogicalPath = (tracerRoot: string, actualPath: string) =>
	`trusted/stylex-tracer/${relative(tracerRoot, actualPath).split(sep).join("/")}`;

export const createStylexTracerBundleAdapter = (
	files: Readonly<Record<string, string>>,
	compilerRoot: string,
	readTrustedSource: (path: string) => string = (path) => readFileSync(path, "utf8"),
	instrumentation?: ClientCompilerBenchmarkInstrumentation,
): StylexTracerBundleAdapter => {
	const {
		tracerRoot,
		paths: trustedPaths,
		entries: trustedEntries,
	} = resolveTrustedStylexSourceSet(compilerRoot);
	const trustedSources: Record<string, TrustedStylexSource> = {};
	for (const actualPath of trustedPaths) {
		const trustedSpecifier = Object.entries(trustedEntries).find(
			([, path]) => path === actualPath,
		)?.[0];
		const extension = actualPath.endsWith(".tsx") ? ".tsx" : ".ts";
		trustedSources[actualPath] = {
			actualPath,
			source: readTrustedSource(actualPath),
			logicalPath: actualPath.startsWith(`${tracerRoot}${sep}`)
				? trustedLogicalPath(tracerRoot, actualPath)
				: `trusted/${trustedSpecifier?.slice("@ryot-app/client-ui-sdk/".length) ?? "unapproved"}${extension}`,
		};
	}
	instrumentation?.count("trusted-source-count", trustedPaths.length);
	instrumentation?.count(
		"trusted-source-bytes",
		Object.values(trustedSources).reduce(
			(total, trusted) => total + new TextEncoder().encode(trusted.source).byteLength,
			0,
		),
	);
	const currentPaths = new Set(Object.keys(trustedSources));
	const stalePath = [
		...new Set([...startupTrustedStylexSourceHashes.keys(), ...currentPaths]),
	].find((path) => {
		const source = trustedSources[path]?.source;
		return (
			startupTrustedStylexSourceHashes.get(path) !==
			(source === undefined ? undefined : sha256Hex(new TextEncoder().encode(source)))
		);
	});
	const identityDiagnostics =
		stalePath === undefined
			? []
			: [
					clientPluginCompilerDiagnostic(
						"RYOT_CLIENT_STYLEX_RESTART_REQUIRED",
						trustedSources[stalePath]?.logicalPath ?? "trusted/stylex-tracer",
						"Trusted StyleX tracer sources changed after compiler startup; restart the compiler before rebuilding",
					),
				];
	const conventionDiagnostics = Object.values(trustedSources).flatMap(({ source, logicalPath }) => {
		const diagnostic = validateStylexAuthoringConvention(logicalPath, source);
		return diagnostic === undefined ? [] : [diagnostic];
	});

	const temporaryRoot = mkdtempSync(join(tmpdir(), "ryot-stylex-tracer-"));
	const archivedPaths: Record<string, string> = {};
	const archivedSources: Record<string, true> = {};
	try {
		for (const [logicalPath, source] of Object.entries(files)) {
			if (!/\.tsx?$/.test(logicalPath)) {
				continue;
			}
			if (canonicalRelativePosixPathIssue(logicalPath) !== null) {
				throw new Error(`StyleX source path "${logicalPath}" is not canonical`);
			}
			const actualPath = join(temporaryRoot, logicalPath);
			mkdirSync(dirname(actualPath), { recursive: true });
			writeFileSync(actualPath, source);
			archivedPaths[logicalPath] = actualPath;
			archivedSources[actualPath] = true;
		}
		instrumentation?.count("materialized-source-count", Object.keys(archivedPaths).length);
		instrumentation?.count(
			"materialized-source-bytes",
			Object.keys(archivedPaths).reduce(
				(total, path) => total + new TextEncoder().encode(files[path] ?? "").byteLength,
				0,
			),
		);
	} catch (error) {
		rmSync(temporaryRoot, { force: true, recursive: true });
		throw error;
	}
	const logicalByArchivedPath = new Map(
		Object.entries(archivedPaths).map(([logicalPath, actualPath]) => [actualPath, logicalPath]),
	);
	const rules: Rule[] = [];

	const filePathResolver = (specifier: string, sourceFilePath: string) => {
		if (STYLEX_TRACER_TRUSTED_MODULES.some((trusted) => trusted === specifier)) {
			return trustedEntries[specifier];
		}
		if (!specifier.startsWith(".")) {
			return undefined;
		}
		if (logicalByArchivedPath.has(sourceFilePath)) {
			const candidate = resolveSourceCandidate(sourceFilePath, specifier, archivedSources);
			if (candidate === undefined) {
				return undefined;
			}
			const logicalImporter = logicalByArchivedPath.get(sourceFilePath) ?? "";
			const logicalCandidate = logicalByArchivedPath.get(candidate) ?? "";
			const clientIndex = logicalImporter.lastIndexOf("/client/");
			let clientBoundary = "";
			if (logicalImporter.startsWith("client/")) {
				clientBoundary = "client/";
			} else if (clientIndex !== -1) {
				clientBoundary = logicalImporter.slice(0, clientIndex + 8);
			}
			return clientBoundary.length > 0 && logicalCandidate.startsWith(clientBoundary)
				? candidate
				: undefined;
		}
		return resolveSourceCandidate(sourceFilePath, specifier, trustedSources);
	};
	const getCanonicalFilePath = (path: string) => {
		const archived = logicalByArchivedPath.get(path);
		if (archived !== undefined) {
			return `/__ryot_stylex__/${archived}`;
		}
		if (Object.hasOwn(trustedSources, path)) {
			return `/__ryot_stylex__/${trustedLogicalPath(tracerRoot, path)}`;
		}
		return "/__ryot_stylex__/unapproved";
	};

	return {
		rules,
		archivedPaths,
		trustedEntries,
		trustedSources,
		cleanup: () => rmSync(temporaryRoot, { force: true, recursive: true }),
		preflightDiagnostics: [...identityDiagnostics, ...conventionDiagnostics],
		resolveTrustedImport: (importer, specifier) =>
			specifier.startsWith(".")
				? resolveSourceCandidate(importer, specifier, trustedSources)
				: undefined,
		transform: (logicalPath, source, actualPath) => {
			const finishTransform = instrumentation?.start("stylex-transform", true);
			try {
				const result = transformSync(source, {
					ast: false,
					code: true,
					babelrc: false,
					configFile: false,
					sourceMaps: false,
					filename: actualPath,
					plugins: [
						[syntaxTypeScript, { isTSX: sourceLoaderExtension(logicalPath) === ".tsx" }],
						syntaxJsx,
						stylexPlugin.withOptions({
							...stylexOptions,
							unstable_moduleResolution: { type: "custom", filePathResolver, getCanonicalFilePath },
						}),
					],
				});
				const metadata: unknown = result?.metadata;
				const extracted =
					typeof metadata === "object" && metadata !== null && "stylex" in metadata
						? metadata.stylex
						: undefined;
				if (extracted !== undefined && !Array.isArray(extracted)) {
					throw new Error("StyleX transform returned invalid rule metadata");
				}
				if (Array.isArray(extracted)) {
					const validRules = extracted.filter(isStylexRule);
					if (validRules.length !== extracted.length) {
						throw new Error("StyleX transform returned invalid rule metadata");
					}
					rules.push(...validRules);
				}
				instrumentation?.count("stylex-transformed-module-count", 1);
				instrumentation?.count(
					"stylex-rule-count",
					Array.isArray(extracted) ? extracted.length : 0,
				);
				return { code: result?.code ?? source };
			} catch (error) {
				return { diagnostic: diagnosticFromBabelError(logicalPath, actualPath, error) };
			} finally {
				finishTransform?.();
			}
		},
	};
};

export const compileStylexTracerStyles = (
	rules: Rule[],
	fontStylesheet: string,
	inputFingerprint: string,
	instrumentation?: ClientCompilerBenchmarkInstrumentation,
) => {
	const extracted = stylexPlugin.processStylexRules(rules, {
		useLayers: { prefix: "ryot-stylex", before: ["ryot-tracer-reset"] },
	});
	const inputIdentity = sha256Hex(new TextEncoder().encode(inputFingerprint));
	instrumentation?.count("stylex-css-rule-count", rules.length);
	return `${fontStylesheet}\n/* ryot-stylex-tracer:${STYLEX_TRACER_BUILD_FINGERPRINT}:${inputIdentity} */\n${tracerReset}\n${extracted}`;
};
