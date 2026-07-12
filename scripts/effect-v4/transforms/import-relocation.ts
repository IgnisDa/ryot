import { basename, relative, resolve, sep } from "node:path";

export const parser = "tsx";

const SCOPE_ROOTS = [
	"apps/app-backend",
	"apps/app-client",
	"apps/website",
	"apps/browser-extension",
	"libs/contract",
	"libs/config",
	"libs/sandbox-sdk",
	"libs/plugin-kit",
	"libs/sandbox-compiler",
	"plugins/fitness",
	"plugins/media",
	"tests",
] as const;

const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();

const PLATFORM_IMPORTS = {
	FileSystem: ["effect", "FileSystem"],
	Path: ["effect", "Path"],
	PlatformLogger: ["effect", "Logger"],
	FetchHttpClient: ["effect/unstable/http", "FetchHttpClient"],
	Headers: ["effect/unstable/http", "Headers"],
	HttpApp: ["effect/unstable/http", "HttpEffect"],
	HttpClient: ["effect/unstable/http", "HttpClient"],
	HttpClientRequest: ["effect/unstable/http", "HttpClientRequest"],
	HttpClientResponse: ["effect/unstable/http", "HttpClientResponse"],
	HttpMiddleware: ["effect/unstable/http", "HttpMiddleware"],
	HttpServer: ["effect/unstable/http", "HttpServer"],
	HttpServerRequest: ["effect/unstable/http", "HttpServerRequest"],
	HttpServerResponse: ["effect/unstable/http", "HttpServerResponse"],
	Multipart: ["effect/unstable/http", "Multipart"],
	HttpApi: ["effect/unstable/httpapi", "HttpApi"],
	HttpApiBuilder: ["effect/unstable/httpapi", "HttpApiBuilder"],
	HttpApiClient: ["effect/unstable/httpapi", "HttpApiClient"],
	HttpApiEndpoint: ["effect/unstable/httpapi", "HttpApiEndpoint"],
	HttpApiError: ["effect/unstable/httpapi", "HttpApiError"],
	HttpApiGroup: ["effect/unstable/httpapi", "HttpApiGroup"],
	HttpApiMiddleware: ["effect/unstable/httpapi", "HttpApiMiddleware"],
	HttpApiScalar: ["effect/unstable/httpapi", "HttpApiScalar"],
	HttpApiSchema: ["effect/unstable/httpapi", "HttpApiSchema"],
	HttpApiSecurity: ["effect/unstable/httpapi", "HttpApiSecurity"],
	OpenApi: ["effect/unstable/httpapi", "OpenApi"],
	Command: ["effect/unstable/process", "ChildProcess"],
	CommandExecutor: ["effect/unstable/process", "ChildProcessSpawner"],
};

const NAMED_IMPORTS = {
	effect: {
		TestClock: ["effect/testing", "TestClock"],
	},
	"@effect/platform": PLATFORM_IMPORTS,
	"@effect/workflow": {
		Activity: ["effect/unstable/workflow", "Activity"],
		DurableClock: ["effect/unstable/workflow", "DurableClock"],
		DurableQueue: ["effect/unstable/workflow", "DurableQueue"],
		Workflow: ["effect/unstable/workflow", "Workflow"],
	},
	"@effect/cluster": {
		ClusterWorkflowEngine: ["effect/unstable/cluster", "ClusterWorkflowEngine"],
		SingleRunner: ["effect/unstable/cluster", "SingleRunner"],
	},
	"@effect-atom/atom-react": {
		RegistryProvider: ["@effect/atom-react", "RegistryProvider"],
		useAtomRefresh: ["@effect/atom-react", "useAtomRefresh"],
		useAtomSet: ["@effect/atom-react", "useAtomSet"],
		useAtomValue: ["@effect/atom-react", "useAtomValue"],
		Atom: ["effect/unstable/reactivity", "Atom"],
		AtomHttpApi: ["effect/unstable/reactivity", "AtomHttpApi"],
		Result: ["effect/unstable/reactivity", "AsyncResult"],
	},
};

const NAMESPACE_IMPORTS = {
	"@effect/platform/KeyValueStore": [
		"KeyValueStore",
		"effect/unstable/persistence",
		"KeyValueStore",
	],
	"@effect/experimental/PersistedQueue": [
		"PersistedQueue",
		"effect/unstable/persistence",
		"PersistedQueue",
	],
	"@effect/experimental/PersistedQueue/Redis": [
		"PersistedQueueRedis",
		"effect/unstable/persistence",
		"Redis",
	],
};

const OLD_MODULES = new Set([
	...Object.keys(NAMED_IMPORTS),
	...Object.keys(NAMESPACE_IMPORTS),
	"@effect/platform/Error",
	"@effect/platform/HttpMethod",
	"@effect/workflow/Workflow",
	"@effect/workflow/WorkflowEngine",
]);

const getRepositoryPath = (path) => {
	const absolutePath = resolve(REPOSITORY_ROOT, path);
	const repositoryPath = relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
	const scopeRoot = SCOPE_ROOTS.find(
		(root) => repositoryPath === root || repositoryPath.startsWith(`${root}/`),
	);
	if (!scopeRoot || GENERATED_FILES.has(basename(repositoryPath))) {
		return;
	}

	const scopedParts = repositoryPath.slice(scopeRoot.length + 1).split("/");
	if (scopedParts.some((part) => EXCLUDED_DIRECTORIES.has(part))) {
		return;
	}
	return repositoryPath;
};

const getImportKind = (declaration, specifier) =>
	declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value";

const getImportedName = (specifier) =>
	specifier.imported?.type === "Identifier" ? specifier.imported.name : undefined;

const hasImportAncestor = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (parent.node.type === "ImportDeclaration") {
			return true;
		}
	}
	return false;
};

const NON_REFERENCE_KEYS = new Set([
	"ClassMethod",
	"ClassProperty",
	"MethodDefinition",
	"ObjectMethod",
	"ObjectProperty",
	"Property",
	"PropertyDefinition",
	"TSMethodSignature",
	"TSPropertySignature",
]);

const isReferenceIdentifier = (path) => {
	const parent = path.parent?.node;
	if (!parent || hasImportAncestor(path)) {
		return false;
	}
	if (
		(parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
		parent.property === path.node &&
		!parent.computed
	) {
		return false;
	}
	if (parent.type === "TSQualifiedName" && parent.right === path.node) {
		return false;
	}
	if (parent.type === "ExportSpecifier" && parent.exported === path.node) {
		return false;
	}
	if (
		(parent.type === "LabeledStatement" ||
			parent.type === "BreakStatement" ||
			parent.type === "ContinueStatement") &&
		parent.label === path.node
	) {
		return false;
	}
	if (NON_REFERENCE_KEYS.has(parent.type) && parent.key === path.node && !parent.computed) {
		return false;
	}
	return true;
};

const getBinding = (specifierPath, local) => {
	const localPath = specifierPath.get("local");
	const scope = localPath.scope?.lookup(local);
	const bindings = scope?.getBindings()[local];
	if (!scope || bindings?.length !== 1 || bindings[0].node !== specifierPath.node.local) {
		return;
	}
	return scope;
};

const getReferences = (root, j, local, scope) =>
	root
		.find(j.Identifier, { name: local })
		.paths()
		.filter((path) => isReferenceIdentifier(path) && path.scope?.lookup(local) === scope);

const getDeclaration = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (parent.node.type === "ImportDeclaration") {
			return parent.node;
		}
	}
};

const copyComments = (from, to) => {
	if (!from.comments?.length) {
		return;
	}
	to.comments = [...from.comments, ...(to.comments ?? [])];
};

const makeSpecifier = (j, contribution) => {
	const local =
		contribution.local === contribution.imported ? null : j.identifier(contribution.local);
	const specifier = j.importSpecifier(j.identifier(contribution.imported), local);
	copyComments(contribution.specifier, specifier);
	return specifier;
};

const kindSatisfies = (actual, requested) => actual === requested || actual === "value";

export default function importRelocation(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[import-relocation] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const declarationPaths = root
		.find(j.ImportDeclaration)
		.paths()
		.filter(
			(path) =>
				OLD_MODULES.has(path.node.source.value) &&
				(path.node.source.value !== "effect" ||
					path.node.specifiers?.some(
						(specifier) => getImportedName(specifier) === "TestClock",
					)),
		);
	if (!declarationPaths.length) {
		return;
	}

	const plans = [];
	const bindings = [];
	const oldBindingNodes = new Map();
	let failure;

	const fail = (reason) => {
		failure ??= reason;
	};

	const addBinding = (plan, specifierPath, contribution, action = "rename") => {
		const local = specifierPath.node.local?.name;
		if (!local) {
			return fail(`unsupported import binding from ${plan.source}`);
		}
		const scope = getBinding(specifierPath, local);
		if (!scope) {
			return fail(`ambiguous binding ${local} from ${plan.source}`);
		}

		const binding = {
			action,
			contribution,
			local,
			references: getReferences(root, j, local, scope),
			scope,
		};
		bindings.push(binding);
		oldBindingNodes.set(specifierPath.node.local, binding);
		plan.contributions.push(contribution);
	};

	const addNamed = (plan, specifierPath, destination, imported, action = "rename") => {
		const originalImported = getImportedName(specifierPath.node);
		const originalLocal = specifierPath.node.local?.name;
		if (!originalImported || !originalLocal) {
			return fail(`unsupported named import from ${plan.source}`);
		}
		const changed = imported !== originalImported;
		const contribution = {
			destination,
			imported,
			kind: getImportKind(plan.node, specifierPath.node),
			local: changed ? imported : originalLocal,
			owner: plan,
			specifier: specifierPath.node,
		};
		addBinding(plan, specifierPath, contribution, action);
	};

	const addNamespace = (plan, specifierPath, destination, imported) => {
		const contribution = {
			destination,
			imported,
			kind: "value",
			local: imported,
			owner: plan,
			specifier: specifierPath.node,
		};
		addBinding(plan, specifierPath, contribution);
	};

	for (const declarationPath of declarationPaths) {
		const node = declarationPath.node;
		const source = node.source.value;
		const plan = {
			contributions: [],
			generated: [],
			node,
			path: declarationPath,
			retained: [],
			source,
		};
		plans.push(plan);

		if (
			(node.importKind && node.importKind !== "type" && node.importKind !== "value") ||
			node.assertions?.length ||
			node.attributes?.length ||
			!node.specifiers?.length
		) {
			fail(`unsupported import declaration from ${source}`);
			continue;
		}
		if (
			node.specifiers.some(
				(specifier) =>
					specifier.importKind &&
					specifier.importKind !== "type" &&
					specifier.importKind !== "value",
			)
		) {
			fail(`unsupported import kind from ${source}`);
			continue;
		}

		const namespaceMapping = NAMESPACE_IMPORTS[source];
		if (namespaceMapping) {
			if (
				node.importKind === "type" ||
				node.specifiers.length !== 1 ||
				node.specifiers[0].type !== "ImportNamespaceSpecifier" ||
				node.specifiers[0].local.name !== namespaceMapping[0]
			) {
				fail(`unsupported namespace import from ${source}`);
				continue;
			}
			const specifierPath = declarationPath.get("specifiers", 0);
			addNamespace(plan, specifierPath, namespaceMapping[1], namespaceMapping[2]);
			continue;
		}

		if (node.specifiers.some((specifier) => specifier.type !== "ImportSpecifier")) {
			fail(`unsupported import shape from ${source}`);
			continue;
		}

		const namedMapping = NAMED_IMPORTS[source];
		if (namedMapping) {
			for (let index = 0; index < node.specifiers.length; index += 1) {
				const specifierPath = declarationPath.get("specifiers", index);
				const imported = getImportedName(specifierPath.node);
				const mapping = imported && namedMapping[imported];
				if (!mapping) {
					if (source === "effect") {
						plan.retained.push(specifierPath.node);
						continue;
					}
					fail(`unsupported import ${imported ?? "<unknown>"} from ${source}`);
					continue;
				}
				addNamed(plan, specifierPath, mapping[0], mapping[1]);
			}
			continue;
		}

		if (source === "@effect/platform/Error") {
			for (let index = 0; index < node.specifiers.length; index += 1) {
				const specifierPath = declarationPath.get("specifiers", index);
				const imported = getImportedName(specifierPath.node);
				if (imported === "PlatformError") {
					addNamed(plan, specifierPath, "effect/PlatformError", "PlatformError");
				} else if (
					imported === "isPlatformError" &&
					getImportKind(node, specifierPath.node) === "value"
				) {
					addNamed(plan, specifierPath, "effect", "PlatformError", "platform-error-call");
				} else {
					fail(`unsupported import ${imported ?? "<unknown>"} from ${source}`);
				}
			}
			continue;
		}

		if (source === "@effect/platform/HttpMethod") {
			const specifierPath = declarationPath.get("specifiers", 0);
			if (
				node.specifiers.length !== 1 ||
				getImportedName(specifierPath.node) !== "isHttpMethod" ||
				getImportKind(node, specifierPath.node) !== "value"
			) {
				fail(`unsupported import from ${source}`);
				continue;
			}
			addNamed(plan, specifierPath, "effect/unstable/http", "HttpMethod", "http-method-reference");
			continue;
		}

		if (source === "@effect/workflow/Workflow") {
			const specifierPath = declarationPath.get("specifiers", 0);
			if (
				node.specifiers.length !== 1 ||
				getImportedName(specifierPath.node) !== "Result" ||
				specifierPath.node.local?.name !== "WorkflowResult" ||
				getImportKind(node, specifierPath.node) !== "type"
			) {
				fail(`unsupported import from ${source}`);
				continue;
			}
			addNamed(plan, specifierPath, "effect/unstable/workflow", "Workflow", "workflow-result");
			continue;
		}

		if (source === "@effect/workflow/WorkflowEngine") {
			const instanceIndex = node.specifiers.findIndex(
				(specifier) => getImportedName(specifier) === "WorkflowInstance",
			);
			const engine = node.specifiers.find(
				(specifier) => getImportedName(specifier) === "WorkflowEngine",
			);
			if (
				instanceIndex >= 0 &&
				engine?.local?.name !== undefined &&
				engine.local.name !== "WorkflowEngine"
			) {
				fail(`unsupported aliased WorkflowEngine with WorkflowInstance from ${source}`);
				continue;
			}

			for (let index = 0; index < node.specifiers.length; index += 1) {
				const specifierPath = declarationPath.get("specifiers", index);
				const imported = getImportedName(specifierPath.node);
				if (imported === "WorkflowEngine") {
					addNamed(plan, specifierPath, "effect/unstable/workflow", "WorkflowEngine");
				} else if (imported === "WorkflowInstance" && specifierPath.node.local?.name === imported) {
					addNamed(
						plan,
						specifierPath,
						"effect/unstable/workflow",
						"WorkflowEngine",
						"workflow-instance",
					);
				} else {
					fail(`unsupported import ${imported ?? "<unknown>"} from ${source}`);
				}
			}
		}
	}

	for (const binding of bindings) {
		if (binding.action === "platform-error-call") {
			const supported = binding.references.every((path) => {
				const call = path.parent?.node;
				return (
					call?.type === "CallExpression" &&
					call.callee === path.node &&
					call.arguments.length === 1 &&
					call.arguments[0].type !== "SpreadElement" &&
					!call.typeArguments &&
					!call.typeParameters
				);
			});
			if (!supported) {
				fail(`unsupported reference to ${binding.local}`);
			}
		} else if (binding.action === "workflow-result") {
			const supported = binding.references.every(
				(path) =>
					path.parent?.node.type === "TSTypeReference" && path.parent.node.typeName === path.node,
			);
			if (!supported) {
				fail(`unsupported value reference to ${binding.local}`);
			}
		}
	}

	const aggregates = new Map();
	for (const plan of plans) {
		for (const contribution of plan.contributions) {
			const key = `${contribution.destination}\0${contribution.imported}\0${contribution.local}`;
			const aggregate = aggregates.get(key);
			if (!aggregate) {
				aggregates.set(key, { ...contribution, key });
			} else if (contribution.kind === "value") {
				aggregate.kind = "value";
			}
			contribution.key = key;
		}
	}

	for (const binding of bindings) {
		const aggregate = aggregates.get(binding.contribution.key);
		const targetBindings = binding.scope.getBindings()[aggregate.local] ?? [];
		for (const targetBinding of targetBindings) {
			const oldBinding = oldBindingNodes.get(targetBinding.node);
			if (oldBinding?.contribution.key === aggregate.key) {
				continue;
			}

			const declaration = getDeclaration(targetBinding);
			const specifier = targetBinding.parent?.node;
			if (
				declaration?.source.value === aggregate.destination &&
				specifier?.type === "ImportSpecifier" &&
				getImportedName(specifier) === aggregate.imported &&
				kindSatisfies(getImportKind(declaration, specifier), aggregate.kind)
			) {
				continue;
			}
			fail(`binding ${aggregate.local} would collide after relocation`);
		}
	}

	if (failure) {
		api.report(`[import-relocation] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}

	for (const binding of bindings) {
		const target = aggregates.get(binding.contribution.key).local;
		if (binding.action === "platform-error-call") {
			for (const path of binding.references) {
				const callPath = path.parent;
				const replacement = j.binaryExpression(
					"instanceof",
					callPath.node.arguments[0],
					j.memberExpression(j.identifier("PlatformError"), j.identifier("PlatformError")),
				);
				copyComments(callPath.node, replacement);
				callPath.replace(replacement);
			}
		} else if (binding.action === "http-method-reference") {
			for (const path of binding.references) {
				path.replace(j.memberExpression(j.identifier("HttpMethod"), j.identifier("isHttpMethod")));
			}
		} else if (binding.action === "workflow-result") {
			for (const path of binding.references) {
				path.replace(j.tsQualifiedName(j.identifier("Workflow"), j.identifier("Result")));
			}
		} else if (binding.action === "workflow-instance") {
			for (const path of binding.references) {
				const replacement =
					path.parent?.node.type === "TSTypeReference" && path.parent.node.typeName === path.node
						? j.tsQualifiedName(j.identifier("WorkflowEngine"), j.identifier("WorkflowInstance"))
						: j.memberExpression(j.identifier("WorkflowEngine"), j.identifier("WorkflowInstance"));
				path.replace(replacement);
			}
		} else if (binding.local !== target) {
			for (const path of binding.references) {
				const parent = path.parent?.node;
				path.node.name = target;
				if (
					(parent?.type === "ObjectProperty" || parent?.type === "Property") &&
					parent.shorthand &&
					parent.value === path.node
				) {
					parent.shorthand = false;
				}
			}
		}
	}

	const oldDeclarations = new Set(plans.map((plan) => plan.node));
	const destinationPaths = root
		.find(j.ImportDeclaration)
		.paths()
		.filter((path) => !oldDeclarations.has(path.node));
	const targets = new Map();
	const generatedGroups = new Map();

	for (const aggregate of aggregates.values()) {
		let targetPath;
		for (const path of destinationPaths) {
			if (path.node.source.value !== aggregate.destination) {
				continue;
			}
			const exact = path.node.specifiers?.find(
				(specifier) =>
					specifier.type === "ImportSpecifier" &&
					getImportedName(specifier) === aggregate.imported &&
					specifier.local?.name === aggregate.local &&
					kindSatisfies(getImportKind(path.node, specifier), aggregate.kind),
			);
			if (exact) {
				targetPath = path;
				break;
			}
		}

		if (!targetPath) {
			targetPath = destinationPaths.find(
				(path) =>
					path.node.source.value === aggregate.destination &&
					Boolean(path.node.specifiers?.length) &&
					!path.node.specifiers.some(
						(specifier) => specifier.type === "ImportNamespaceSpecifier",
					) &&
					(path.node.importKind === "type") === (aggregate.kind === "type"),
			);
			if (targetPath) {
				targetPath.node.specifiers.push(makeSpecifier(j, aggregate));
			}
		}

		if (targetPath) {
			targets.set(aggregate.key, targetPath.node);
			continue;
		}

		const groupKey = `${plans.indexOf(aggregate.owner)}\0${aggregate.destination}\0${aggregate.kind}`;
		let declaration = generatedGroups.get(groupKey);
		if (!declaration) {
			declaration = j.importDeclaration([], j.literal(aggregate.destination));
			if (aggregate.kind === "type") {
				declaration.importKind = "type";
			}
			aggregate.owner.generated.push(declaration);
			generatedGroups.set(groupKey, declaration);
		}
		declaration.specifiers.push(makeSpecifier(j, aggregate));
		targets.set(aggregate.key, declaration);
	}

	for (const plan of plans) {
		if (plan.retained.length) {
			continue;
		}
		const target =
			plan.generated[0] ?? plan.contributions.map((item) => targets.get(item.key)).find(Boolean);
		if (target) {
			copyComments(plan.node, target);
		}
	}

	for (const plan of plans.toReversed()) {
		if (plan.retained.length) {
			plan.node.specifiers = plan.retained;
			if (plan.generated.length) {
				plan.path.replace(plan.node, ...plan.generated);
			}
		} else if (plan.generated.length) {
			plan.path.replace(...plan.generated);
		} else {
			plan.path.prune();
		}
	}

	const output = root.toSource();
	api.report(`[import-relocation] transformed ${repositoryPath}`);
	return output;
}
