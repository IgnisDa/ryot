import { Effect } from "effect";
import type {
	CallExpression,
	Identifier,
	Node,
	ObjectLiteralExpression,
	SourceFile,
	Statement,
} from "typescript/unstable/ast";
import {
	isArrowFunction,
	isBindingElement,
	isBlock,
	isCallExpression,
	isClassDeclaration,
	isFunctionDeclaration,
	isFunctionExpression,
	isIdentifier,
	isImportClause,
	isImportDeclaration,
	isImportSpecifier,
	isMethodDeclaration,
	isNamedImports,
	isNamespaceImport,
	isObjectLiteralExpression,
	isParameterDeclaration,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isPropertySignatureDeclaration,
	isQualifiedName,
	isStringLiteral,
	isVariableDeclaration,
	isVariableStatement,
	isYieldExpression,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

export type DispatchContext =
	| "task"
	| "route"
	| "other"
	| "worker"
	| "layers"
	| "service"
	| "activity"
	| "workflow"
	| "repository";

export type DispatchFinding = {
	file: string;
	via: string[];
	symbol: string;
	context: DispatchContext;
	kind: "direct" | "transitive";
};

type MarkerKind = "engine-execute" | "workflow-execute" | "durable-queue";

type Decl = {
	id: number;
	end: number;
	file: string;
	name: string;
	start: number;
	symbol: string;
	sf: SourceFile;
	node: Node | undefined;
	enclosingService: string | undefined;
	kind: "function" | "const" | "class" | "service-method" | "module";
};

type ParsedFile = {
	abs: string;
	rel: string;
	sf: SourceFile;
	diReceivers: Map<string, string>;
	imports: Map<string, { module: string; original: string }>;
};

const toForward = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");

const dirOf = (value: string) => {
	const index = value.lastIndexOf("/");
	return index === -1 ? "" : value.slice(0, index);
};

const baseOf = (value: string) => {
	const index = value.lastIndexOf("/");
	return index === -1 ? value : value.slice(index + 1);
};

const joinAndNormalize = (from: string, spec: string): string => {
	const segments = `${from}/${spec}`.split("/");
	const stack: string[] = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			stack.pop();
		} else {
			stack.push(segment);
		}
	}
	const prefix = from.startsWith("/") ? "/" : "";
	return prefix + stack.join("/");
};

// tsgo may return absolute paths whose drive letter case differs from Bun's; match leniently.
const relativeTo = (root: string, abs: string) => {
	if (abs.startsWith(`${root}/`)) {
		return abs.slice(root.length + 1);
	}
	if (abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
		return abs.slice(root.length + 1);
	}
	return abs;
};

const endsWithWorkflow = (name: string) => name.endsWith("Workflow");

const declSymbol = (name: string, kind: Decl["kind"], enclosingService: string | undefined) => {
	if (kind === "module") {
		return "<module>";
	}
	if (kind === "service-method" && enclosingService) {
		return `${enclosingService}.${name}`;
	}
	return name;
};

const isValueReference = (node: Identifier): boolean => {
	const p = node.parent;
	if (isPropertyAccessExpression(p) && p.name === node) {
		return false;
	}
	if (isQualifiedName(p) && p.right === node) {
		return false;
	}
	if (isPropertyAssignment(p) && p.name === node) {
		return false;
	}
	if (isMethodDeclaration(p) && p.name === node) {
		return false;
	}
	if (isPropertySignatureDeclaration(p) && p.name === node) {
		return false;
	}
	if (isBindingElement(p) && p.propertyName === node) {
		return false;
	}
	if (isParameterDeclaration(p) && p.name === node) {
		return false;
	}
	if (isVariableDeclaration(p) && p.name === node) {
		return false;
	}
	if (isFunctionDeclaration(p) && p.name === node) {
		return false;
	}
	if (isClassDeclaration(p) && p.name === node) {
		return false;
	}
	if (isImportSpecifier(p) || isImportClause(p) || isNamespaceImport(p)) {
		return false;
	}
	return true;
};

const serviceOptionsFromCall = (call: CallExpression): ObjectLiteralExpression | null => {
	const inner = call.expression;
	if (!isCallExpression(inner)) {
		return null;
	}
	const target = inner.expression;
	if (
		!isPropertyAccessExpression(target) ||
		target.name.text !== "Service" ||
		!isIdentifier(target.expression) ||
		target.expression.text !== "Effect"
	) {
		return null;
	}
	const options = call.arguments[1];
	return options && isObjectLiteralExpression(options) ? options : null;
};

const effectBodyStatements = (options: ObjectLiteralExpression): Statement[] => {
	for (const property of options.properties) {
		if (
			!isPropertyAssignment(property) ||
			!isIdentifier(property.name) ||
			property.name.text !== "effect"
		) {
			continue;
		}
		let initializer: Node = property.initializer;
		if (isCallExpression(initializer)) {
			const fn = initializer.arguments.find(
				(argument) => isFunctionExpression(argument) || isArrowFunction(argument),
			);
			if (fn) {
				initializer = fn;
			}
		}
		if (
			(isFunctionExpression(initializer) || isArrowFunction(initializer)) &&
			isBlock(initializer.body)
		) {
			return [...initializer.body.statements];
		}
	}
	return [];
};

const resolveSpecifier = (
	spec: string,
	fromDir: string,
	srcRoot: string,
	fileSet: Set<string>,
): string | null => {
	let base: string | null = null;
	if (spec.startsWith("#")) {
		base = joinAndNormalize(srcRoot, spec.slice(1));
	} else if (spec.startsWith(".")) {
		base = joinAndNormalize(fromDir, spec);
	} else {
		return null;
	}
	const candidates = [`${base}.ts`, `${base}/index.ts`, base];
	for (const candidate of candidates) {
		if (fileSet.has(candidate)) {
			return candidate;
		}
	}
	return null;
};

// Node.parent is typed as non-optional but is undefined at the SourceFile root at runtime.
const ancestors = function* (node: Node): Generator<Node> {
	let current = node.parent as Node | undefined;
	while (current !== undefined) {
		yield current;
		current = current.parent as Node | undefined;
	}
};

const hasActivityMakeAncestor = (node: Node): boolean => {
	for (const current of ancestors(node)) {
		if (
			!isPropertyAssignment(current) ||
			!isIdentifier(current.name) ||
			current.name.text !== "execute" ||
			!isObjectLiteralExpression(current.parent) ||
			!isCallExpression(current.parent.parent)
		) {
			continue;
		}
		const callee = current.parent.parent.expression;
		if (
			isPropertyAccessExpression(callee) &&
			callee.name.text === "make" &&
			isIdentifier(callee.expression) &&
			callee.expression.text === "Activity"
		) {
			return true;
		}
	}
	return false;
};

const hasToLayerAncestor = (node: Node): boolean => {
	for (const current of ancestors(node)) {
		if (
			isCallExpression(current) &&
			isPropertyAccessExpression(current.expression) &&
			current.expression.name.text === "toLayer"
		) {
			return true;
		}
	}
	return false;
};

const collectFindings = (api: API, packageRoot: string, srcRoot: string): DispatchFinding[] => {
	const snapshot = api.updateSnapshot({ openProjects: [`${packageRoot}/tsconfig.json`] });
	const project = snapshot.getProjects()[0];
	if (!project) {
		return [];
	}
	const program = project.program;

	const srcRootLower = srcRoot.toLowerCase();
	const sourceFiles = program
		.getSourceFileNames()
		.map((raw) => ({ raw, abs: toForward(raw) }))
		.filter(({ abs }) => {
			const lower = abs.toLowerCase();
			return (
				lower.startsWith(`${srcRootLower}/`) &&
				abs.endsWith(".ts") &&
				!abs.endsWith(".test.ts") &&
				!abs.includes("/drizzle/")
			);
		});
	const fileSet = new Set(sourceFiles.map(({ abs }) => abs));

	const decls: Decl[] = [];
	const declsByFile = new Map<string, Decl[]>();
	const parsed: ParsedFile[] = [];
	const serviceRegistry = new Map<string, { file: string; methods: Map<string, number> }>();
	const directMarkers: Array<{ file: ParsedFile; node: Node; kind: MarkerKind }> = [];

	let nextId = 0;
	const relOf = (abs: string) => relativeTo(srcRoot, abs);

	for (const { raw, abs } of sourceFiles) {
		const sf = program.getSourceFile(raw);
		if (!sf) {
			continue;
		}
		const rel = relOf(abs);
		const fromDir = dirOf(abs);
		const diReceivers = new Map<string, string>();
		const imports = new Map<string, { module: string; original: string }>();

		const addDecl = (
			name: string,
			kind: Decl["kind"],
			node: Node,
			enclosingService?: string,
		): Decl => {
			const symbol = declSymbol(name, kind, enclosingService);
			const decl: Decl = {
				sf,
				node,
				name,
				kind,
				symbol,
				file: rel,
				id: nextId++,
				enclosingService,
				end: node.getEnd(),
				start: node.getStart(sf),
			};
			decls.push(decl);
			const list = declsByFile.get(rel) ?? [];
			list.push(decl);
			declsByFile.set(rel, list);
			return decl;
		};

		const registerService = (serviceName: string, options: ObjectLiteralExpression) => {
			const methods = new Map<string, number>();
			for (const statement of effectBodyStatements(options)) {
				if (isVariableStatement(statement)) {
					for (const declaration of statement.declarationList.declarations) {
						if (isIdentifier(declaration.name)) {
							const decl = addDecl(
								declaration.name.text,
								"service-method",
								declaration,
								serviceName,
							);
							methods.set(declaration.name.text, decl.id);
						}
					}
				} else if (isFunctionDeclaration(statement) && statement.name) {
					const decl = addDecl(statement.name.text, "service-method", statement, serviceName);
					methods.set(statement.name.text, decl.id);
				}
			}
			serviceRegistry.set(serviceName, { file: rel, methods });
		};

		for (const statement of sf.statements) {
			if (isFunctionDeclaration(statement) && statement.name) {
				addDecl(statement.name.text, "function", statement);
			} else if (isClassDeclaration(statement) && statement.name) {
				const serviceCall = statement.heritageClauses
					?.flatMap((clause) => clause.types)
					.map((type) => type.expression)
					.find(isCallExpression);
				const options = serviceCall ? serviceOptionsFromCall(serviceCall) : null;
				if (options) {
					registerService(statement.name.text, options);
				} else {
					addDecl(statement.name.text, "class", statement);
				}
			} else if (isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					if (!isIdentifier(declaration.name)) {
						continue;
					}
					const initializer = declaration.initializer;
					const options =
						initializer && isCallExpression(initializer)
							? serviceOptionsFromCall(initializer)
							: null;
					if (options) {
						registerService(declaration.name.text, options);
					} else {
						addDecl(declaration.name.text, "const", declaration);
					}
				}
			}
		}

		const walkCollect = (node: Node) => {
			if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
				const module = resolveSpecifier(node.moduleSpecifier.text, fromDir, srcRoot, fileSet);
				const bindings = node.importClause?.namedBindings;
				if (module && bindings && isNamedImports(bindings)) {
					for (const element of bindings.elements) {
						imports.set(element.name.text, {
							module,
							original: (element.propertyName ?? element.name).text,
						});
					}
				}
			}
			if (
				isVariableDeclaration(node) &&
				isIdentifier(node.name) &&
				node.initializer &&
				isYieldExpression(node.initializer) &&
				node.initializer.asteriskToken &&
				node.initializer.expression &&
				isIdentifier(node.initializer.expression)
			) {
				diReceivers.set(node.name.text, node.initializer.expression.text);
			}
			node.forEachChild(walkCollect);
		};
		walkCollect(sf);

		parsed.push({ abs, rel, sf, imports, diReceivers });
	}

	for (const file of parsed) {
		const walkMarkers = (node: Node) => {
			if (isCallExpression(node)) {
				const callee = node.expression;
				if (isPropertyAccessExpression(callee)) {
					const method = callee.name.text;
					const firstArg = node.arguments[0];
					if (
						method === "execute" &&
						firstArg &&
						isIdentifier(firstArg) &&
						endsWithWorkflow(firstArg.text)
					) {
						directMarkers.push({ file, node, kind: "engine-execute" });
					} else if (
						method === "execute" &&
						isIdentifier(callee.expression) &&
						endsWithWorkflow(callee.expression.text)
					) {
						directMarkers.push({ file, node, kind: "workflow-execute" });
					} else if (
						method === "process" &&
						isIdentifier(callee.expression) &&
						callee.expression.text === "DurableQueue"
					) {
						directMarkers.push({ file, node, kind: "durable-queue" });
					}
				}
			}
			node.forEachChild(walkMarkers);
		};
		walkMarkers(file.sf);
	}

	// Declarations never overlap within a file, so the first containing span is the innermost.
	const innermostDecl = (file: string, node: Node): Decl | null => {
		const pos = node.getStart(node.getSourceFile());
		for (const decl of declsByFile.get(file) ?? []) {
			if (pos >= decl.start && pos < decl.end) {
				return decl;
			}
		}
		return null;
	};

	const moduleDecls = new Map<string, Decl>();
	const moduleDecl = (file: ParsedFile): Decl => {
		const existing = moduleDecls.get(file.rel);
		if (existing) {
			return existing;
		}
		const decl: Decl = {
			start: 0,
			sf: file.sf,
			id: nextId++,
			file: file.rel,
			kind: "module",
			node: undefined,
			name: "<module>",
			symbol: "<module>",
			end: file.sf.getEnd(),
			enclosingService: undefined,
		};
		decls.push(decl);
		moduleDecls.set(file.rel, decl);
		return decl;
	};

	const taint = new Map<number, { kind: "direct" | "transitive"; via: string[]; trigger: Node }>();
	for (const marker of directMarkers) {
		const owner = innermostDecl(marker.file.rel, marker.node) ?? moduleDecl(marker.file);
		if (!taint.has(owner.id)) {
			taint.set(owner.id, { kind: "direct", via: [], trigger: marker.node });
		}
	}

	const dependents = new Map<number, Array<{ referrer: number; trigger: Node }>>();
	const addDependent = (targetId: number, referrer: number, trigger: Node) => {
		if (targetId === referrer) {
			return;
		}
		const list = dependents.get(targetId) ?? [];
		list.push({ referrer, trigger });
		dependents.set(targetId, list);
	};

	const importTarget = (file: ParsedFile, name: string): Decl | null => {
		const imported = file.imports.get(name);
		if (!imported) {
			return null;
		}
		for (const decl of declsByFile.get(relOf(imported.module)) ?? []) {
			if (decl.name === imported.original && decl.kind !== "service-method") {
				return decl;
			}
		}
		return null;
	};

	for (const file of parsed) {
		const localByName = new Map<string, Decl[]>();
		for (const decl of declsByFile.get(file.rel) ?? []) {
			const list = localByName.get(decl.name) ?? [];
			list.push(decl);
			localByName.set(decl.name, list);
		}

		const walkEdges = (node: Node) => {
			if (isIdentifier(node) && isValueReference(node)) {
				const owner = innermostDecl(file.rel, node);
				if (owner) {
					for (const local of localByName.get(node.text) ?? []) {
						addDependent(local.id, owner.id, node);
					}
					const imported = importTarget(file, node.text);
					if (imported) {
						addDependent(imported.id, owner.id, node);
					}
				}
			}
			if (
				isCallExpression(node) &&
				isPropertyAccessExpression(node.expression) &&
				isIdentifier(node.expression.expression)
			) {
				const serviceName = file.diReceivers.get(node.expression.expression.text);
				const service = serviceName ? serviceRegistry.get(serviceName) : undefined;
				const methodId = service?.methods.get(node.expression.name.text);
				if (methodId !== undefined) {
					const owner = innermostDecl(file.rel, node);
					if (owner) {
						addDependent(methodId, owner.id, node.expression);
					}
				}
			}
			node.forEachChild(walkEdges);
		};
		walkEdges(file.sf);
	}

	const symbolById = new Map(decls.map((decl) => [decl.id, decl.symbol]));

	// Breadth-first from directly tainted declarations yields shortest, deterministic chains.
	let frontier = [...taint.keys()].sort((a, b) => a - b);
	while (frontier.length > 0) {
		const next: number[] = [];
		for (const currentId of frontier) {
			const currentTaint = taint.get(currentId);
			if (!currentTaint) {
				continue;
			}
			const referrers = (dependents.get(currentId) ?? [])
				.slice()
				.sort((a, b) =>
					(symbolById.get(a.referrer) ?? "").localeCompare(symbolById.get(b.referrer) ?? ""),
				);
			for (const { referrer, trigger } of referrers) {
				if (taint.has(referrer)) {
					continue;
				}
				taint.set(referrer, {
					kind: "transitive",
					trigger,
					via: [symbolById.get(currentId) ?? "", ...currentTaint.via],
				});
				next.push(referrer);
			}
		}
		frontier = next;
	}

	const declById = new Map(decls.map((decl) => [decl.id, decl]));

	const classify = (decl: Decl, trigger: Node): DispatchContext => {
		if (hasActivityMakeAncestor(trigger)) {
			return "activity";
		}
		const base = baseOf(decl.file);
		if (decl.kind === "service-method" || /modules\/[^/]+\/service\.ts$/.test(decl.file)) {
			return "service";
		}
		if (/modules\/[^/]+\/repository[^/]*\.ts$/.test(decl.file)) {
			return "repository";
		}
		if (base.includes("workflow") || hasToLayerAncestor(trigger)) {
			return "workflow";
		}
		if (base === "routes.ts") {
			return "route";
		}
		if (base.includes("task") || base.includes("cron")) {
			return "task";
		}
		if (base.includes("worker")) {
			return "worker";
		}
		if (decl.file === "app/layers.ts") {
			return "layers";
		}
		return "other";
	};

	const findings: DispatchFinding[] = [];
	for (const [id, info] of taint) {
		const decl = declById.get(id);
		if (!decl) {
			continue;
		}
		findings.push({
			via: info.via,
			kind: info.kind,
			file: decl.file,
			symbol: decl.symbol,
			context: classify(decl, info.trigger),
		});
	}

	findings.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol));
	return findings;
};

// packageRoot is the app-backend directory (contains tsconfig.json and src/). The native tsgo
// API parses the tsconfig project; production files are the project's src/*.ts excluding tests.
export const analyzeWorkflowDispatch = (
	packageRootInput: string,
): Effect.Effect<DispatchFinding[]> => {
	const packageRoot = toForward(packageRootInput);
	const srcRoot = `${packageRoot}/src`;
	return Effect.acquireUseRelease(
		Effect.sync(() => new API({ cwd: packageRoot })),
		(api) => Effect.sync(() => collectFindings(api, packageRoot, srcRoot)),
		(api) => Effect.sync(() => api.close()),
	);
};
