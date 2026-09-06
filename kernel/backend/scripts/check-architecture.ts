#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Data, Effect, Path } from "effect";
import {
	type CallExpression,
	type Expression,
	isCallExpression,
	isIdentifier,
	isImportSpecifier,
	isPropertyAccessExpression,
	isStringLiteral,
	isVariableDeclaration,
	type Node,
	type NodeArray,
	type SourceFile,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem } from "typescript/unstable/fs";

import { findDuplicateServiceLayers, type LayerWiringSource } from "./layer-wiring";
import { analyzeRuntimeModules, formatRuntimeCycleDiagnostics } from "./runtime-module-analysis";
import { walkSourceFiles } from "./walk-source-tree";

class ArchitectureCheckError extends Data.TaggedError("ArchitectureCheckError")<{
	message: string;
}> {}

const isProductionSourcePath = (file: string) =>
	file.endsWith(".ts") &&
	!file.endsWith(".test.ts") &&
	!file.endsWith(".spec.ts") &&
	!file.endsWith(".test-support.ts") &&
	!file.endsWith(".test-fixture.ts") &&
	!file.endsWith(".typecheck.ts") &&
	!file.endsWith(".generated.ts") &&
	!file.replaceAll("\\", "/").includes("/test-fixtures/");

const walkSources = (directory: string, workspaceRoot: string) =>
	walkSourceFiles(directory, workspaceRoot, isProductionSourcePath).pipe(
		Effect.map((files) =>
			Object.entries(files).map(([path, source]) => ({ path, source }) satisfies LayerWiringSource),
		),
	);

const backupOnlyRestoreCalls = [
	".restoreEntity(",
	".restoreEvents(",
	".restoreRelationship(",
	".restorePortableProfile(",
	".restoreRenderer(",
	".restoreForUser(",
	".restoreTranslation(",
	".restoreCustomView(",
	".restoreBuiltinViews(",
	".restoreBuiltinStateBySlug(",
	".restoreNotificationSubscription(",
	".activateRestored(",
	"installations.restore(",
];

const findBackupRestoreBoundaryViolations = (sources: ReadonlyArray<LayerWiringSource>) =>
	sources.flatMap(({ path, source }) => {
		if (path.startsWith("kernel/backend/src/modules/backups/restore/")) {
			return [];
		}
		return backupOnlyRestoreCalls.flatMap((call) =>
			source.includes(call)
				? [
						`${path}: ${call.slice(0, -1)} is a historical write reserved for the backup restore module`,
					]
				: [],
		);
	});

const workflowScopePath = "kernel/backend/src/lib/infrastructure/workflow-scope.ts";

export const findWorkflowScopeViolations = (sources: ReadonlyArray<LayerWiringSource>) =>
	sources.flatMap(({ path, source }) => {
		if (path === workflowScopePath) {
			return [];
		}
		const violations: string[] = [];
		if (source.includes("Activity.make(")) {
			violations.push(
				`${path}: Activity.make( must go through makeActivity in src/lib/infrastructure/workflow-scope.ts`,
			);
		}
		if (source.includes(".toLayer(")) {
			violations.push(
				`${path}: .toLayer( must go through implementWorkflow in src/lib/infrastructure/workflow-scope.ts`,
			);
		}
		return violations;
	});

const mutationMethods = new Set(["post", "put", "patch", "delete"]);

const authMiddlewareNames = (sourceFile: SourceFile): ReadonlySet<string> => {
	const names = new Set(["AuthMiddleware"]);
	const collectImportAliases = (node: Node): void => {
		if (isImportSpecifier(node) && node.propertyName?.text === "AuthMiddleware") {
			names.add(node.name.text);
		}
		node.forEachChild(collectImportAliases);
	};
	collectImportAliases(sourceFile);
	const collectLocalAliases = (node: Node): void => {
		if (
			isVariableDeclaration(node) &&
			isIdentifier(node.name) &&
			node.initializer &&
			isIdentifier(node.initializer) &&
			names.has(node.initializer.text)
		) {
			names.add(node.name.text);
		}
		node.forEachChild(collectLocalAliases);
	};
	collectLocalAliases(sourceFile);
	return names;
};

type FluentOperation = {
	readonly name: string;
	readonly arguments: NodeArray<Expression>;
	readonly call: CallExpression;
};

const fluentOperations = (
	expression: Expression,
	initializers: ReadonlyMap<string, Expression>,
	resolving: ReadonlySet<string> = new Set(),
): ReadonlyArray<FluentOperation> => {
	if (isIdentifier(expression)) {
		const initializer = initializers.get(expression.text);
		if (!initializer || resolving.has(expression.text)) {
			return [];
		}
		return fluentOperations(initializer, initializers, new Set([...resolving, expression.text]));
	}
	if (!isCallExpression(expression) || !isPropertyAccessExpression(expression.expression)) {
		return [];
	}
	return [
		...fluentOperations(expression.expression.expression, initializers, resolving),
		{ call: expression, arguments: expression.arguments, name: expression.expression.name.text },
	];
};

type ContractEndpoint = {
	readonly method: string;
	readonly route: string;
	readonly node: CallExpression;
	readonly hasDemoPolicy: boolean;
	authenticated: boolean;
};

const parseEndpoint = (
	expression: Expression,
	initializers: ReadonlyMap<string, Expression>,
	authMiddlewareIdentifiers: ReadonlySet<string>,
): ContractEndpoint | undefined => {
	const operations = fluentOperations(expression, initializers);
	const endpoint = operations.find(({ name }) =>
		["get", "head", "options", ...mutationMethods].includes(name),
	);
	if (!endpoint) {
		return undefined;
	}
	const policy = operations.find(
		({ name, arguments: args }) =>
			name === "annotate" &&
			args[0] !== undefined &&
			isIdentifier(args[0]) &&
			args[0].text === "DemoAccessPolicy",
	);
	const policyValue = policy?.arguments[1];
	return {
		node: endpoint.call,
		method: endpoint.name,
		route:
			endpoint.arguments[1] !== undefined && isStringLiteral(endpoint.arguments[1])
				? endpoint.arguments[1].text
				: "<unknown route>",
		hasDemoPolicy:
			policyValue !== undefined &&
			isStringLiteral(policyValue) &&
			(policyValue.text === "allowed" || policyValue.text === "protected"),
		authenticated: operations.some(
			({ name, arguments: args }) =>
				name === "middleware" &&
				args[0] !== undefined &&
				isIdentifier(args[0]) &&
				authMiddlewareIdentifiers.has(args[0].text),
		),
	};
};

const inspectContractSource = (path: string, sourceFile: SourceFile): ReadonlyArray<string> => {
	const authMiddlewareIdentifiers = authMiddlewareNames(sourceFile);
	const initializers = new Map<string, Expression>();
	const collectInitializers = (node: Node): void => {
		if (isVariableDeclaration(node) && isIdentifier(node.name) && node.initializer) {
			initializers.set(node.name.text, node.initializer);
		}
		node.forEachChild(collectInitializers);
	};
	collectInitializers(sourceFile);

	const endpoints: ContractEndpoint[] = [];
	const visit = (node: Node): void => {
		if (isVariableDeclaration(node) && node.initializer) {
			const groupEndpoints: ContractEndpoint[] = [];
			for (const operation of fluentOperations(node.initializer, initializers)) {
				if (operation.name === "add" && operation.arguments[0]) {
					const endpoint = parseEndpoint(
						operation.arguments[0],
						initializers,
						authMiddlewareIdentifiers,
					);
					if (endpoint) {
						groupEndpoints.push(endpoint);
					}
				}
				if (
					operation.name === "middleware" &&
					operation.arguments[0] !== undefined &&
					isIdentifier(operation.arguments[0]) &&
					authMiddlewareIdentifiers.has(operation.arguments[0].text)
				) {
					for (const endpoint of groupEndpoints) {
						endpoint.authenticated = true;
					}
				}
			}
			endpoints.push(...groupEndpoints);
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return endpoints.flatMap((endpoint) => {
		if (
			!endpoint.authenticated ||
			!mutationMethods.has(endpoint.method) ||
			endpoint.hasDemoPolicy
		) {
			return [];
		}
		const { line } = sourceFile.getLineAndCharacterOfPosition(endpoint.node.getStart(sourceFile));
		return [
			`${path}:${line + 1}: authenticated ${endpoint.method.toUpperCase()} ${endpoint.route} must annotate DemoAccessPolicy with "allowed" or "protected"`,
		];
	});
};

export const findDemoAccessPolicyViolations = (
	sources: ReadonlyArray<LayerWiringSource>,
): Promise<ReadonlyArray<string>> => {
	const files = Object.fromEntries(sources.map(({ path, source }) => [`/${path}`, source]));
	files["/tsconfig.json"] = JSON.stringify({ files: Object.keys(files) });
	const api = new API({ cwd: "/", fs: createVirtualFileSystem(files) });
	return api
		.updateSnapshot({ openProject: "/tsconfig.json" })
		.then((snapshot) => {
			const project = snapshot.getProject("/tsconfig.json");
			if (!project) {
				return ["Unable to parse contract modules for demo access policy"];
			}
			return Promise.all(
				sources.map(({ path }) =>
					project.program
						.getSourceFile(`/${path}`)
						.then((sourceFile) =>
							sourceFile
								? inspectContractSource(path, sourceFile)
								: [`${path}: unable to parse contract module`],
						),
				),
			).then((findings) => findings.flat());
		})
		.then(
			(findings) => api.close().then(() => findings),
			(cause) =>
				api.close().then(() => {
					throw cause;
				}),
		);
};

const isAllSourcePath = (file: string) => file.endsWith(".ts") && !file.endsWith(".generated.ts");

const walkAllSources = (directory: string, workspaceRoot: string) =>
	walkSourceFiles(directory, workspaceRoot, isAllSourcePath).pipe(
		Effect.map((files) =>
			Object.entries(files).map(([path, source]) => ({ path, source }) satisfies LayerWiringSource),
		),
	);

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const workspaceRoot = path.resolve(path.dirname(scriptPath), "..", "..", "..");
	const modulesDir = path.join(workspaceRoot, "kernel/backend/src/modules");
	const contractModulesDir = path.join(workspaceRoot, "packages/contract/src/modules");
	const roots = ["kernel/backend/src", "packages/contract/src", "packages/ryotql/src"].map((root) =>
		path.join(workspaceRoot, root),
	);
	const cycles = yield* analyzeRuntimeModules(modulesDir);
	const sources = (yield* Effect.forEach(roots, (root) => walkSources(root, workspaceRoot))).flat();
	const allBackendSources = yield* walkAllSources(
		path.join(workspaceRoot, "kernel/backend/src"),
		workspaceRoot,
	);
	const contractModuleSources = yield* walkSources(contractModulesDir, workspaceRoot);
	const duplicateLayers = findDuplicateServiceLayers(sources);
	const backupRestoreBoundaryViolations = findBackupRestoreBoundaryViolations(sources);
	const workflowScopeViolations = findWorkflowScopeViolations(allBackendSources);
	const demoAccessPolicyViolations = yield* Effect.promise(() =>
		findDemoAccessPolicyViolations(contractModuleSources),
	);
	if (
		cycles.length ||
		duplicateLayers.length ||
		backupRestoreBoundaryViolations.length ||
		workflowScopeViolations.length ||
		demoAccessPolicyViolations.length
	) {
		return yield* new ArchitectureCheckError({
			message: [
				...duplicateLayers,
				...backupRestoreBoundaryViolations,
				...workflowScopeViolations,
				...demoAccessPolicyViolations,
				...(cycles.length ? [formatRuntimeCycleDiagnostics(cycles)] : []),
			].join("\n"),
		});
	}
	return yield* Effect.logInfo(`Kernel architecture checks passed (${sources.length} files)`);
}).pipe(Effect.tapError((error) => Effect.logError(String(error))));

if (import.meta.main) {
	BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
}
