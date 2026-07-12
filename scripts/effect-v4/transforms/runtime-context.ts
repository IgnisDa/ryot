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
const RUNNER_RENAMES = new Map([
	["runFork", "runForkWith"],
	["runPromise", "runPromiseWith"],
	["runPromiseExit", "runPromiseExitWith"],
]);
const DIRECT_IMPORT_TARGETS = new Map([
	["effect/Effect", new Set(["runtime"])],
	["effect/Runtime", new Set(["Runtime", ...RUNNER_RENAMES.keys()])],
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

const getAncestorPath = (path, type) => {
	for (let parent = path; parent; parent = parent.parent) {
		if (parent.node?.type === type) {
			return parent;
		}
	}
};

const getImportKind = (declaration, specifier) =>
	declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value";

const getImportedName = (specifier) =>
	specifier.imported?.type === "Identifier" ? specifier.imported.name : undefined;

const isTypeParameterShadowed = (identifierPath, local) => {
	for (let parent = identifierPath.parent; parent; parent = parent.parent) {
		const parameters = parent.node?.typeParameters;
		if (
			parameters?.type === "TSTypeParameterDeclaration" &&
			parameters.params.some((parameter) =>
				typeof parameter.name === "string"
					? parameter.name === local
					: parameter.name?.name === local,
			)
		) {
			return true;
		}
	}
	return false;
};

const getImportBinding = (identifierPath) => {
	const local = identifierPath.node?.name;
	if (!local || isTypeParameterShadowed(identifierPath, local)) {
		return;
	}

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || bindings?.length !== 1) {
			return;
		}

		const path = bindings[0];
		const declarationPath = getAncestorPath(path, "ImportDeclaration");
		const specifier = path.parent?.node;
		if (!declarationPath || !specifier || specifier.local !== path.node) {
			return;
		}

		return {
			declarationPath,
			imported: getImportedName(specifier),
			kind: getImportKind(declarationPath.node, specifier),
			local,
			scope,
			source: declarationPath.node.source.value,
			specifier,
		};
	} catch {
		return;
	}
};

const isStringLiteral = (node) =>
	(node?.type === "StringLiteral" || node?.type === "Literal") &&
	typeof node.value === "string";

const getMemberName = (node) => {
	if (node.type === "TSQualifiedName") {
		return node.right?.type === "Identifier" ? node.right.name : undefined;
	}
	if (!node.computed && node.property?.type === "Identifier") {
		return node.property.name;
	}
	if (node.computed && isStringLiteral(node.property)) {
		return node.property.value;
	}
};

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
	if (
		NON_REFERENCE_KEYS.has(parent.type) &&
		parent.key === path.node &&
		!parent.computed &&
		!(parent.shorthand && parent.value === path.node)
	) {
		return false;
	}
	return true;
};

const getReferences = (root, j, binding) => {
	try {
		return root
			.find(j.Identifier, { name: binding.local })
			.paths()
			.filter(
				(path) =>
					isReferenceIdentifier(path) &&
					!isTypeParameterShadowed(path, binding.local) &&
					path.scope?.lookup(binding.local) === binding.scope,
			);
	} catch {
		return;
	}
};

const getTypeParameters = (node) => node.typeArguments ?? node.typeParameters;

const isOrdinaryMember = (node) =>
	node.type === "MemberExpression" &&
	!node.computed &&
	!node.optional &&
	node.property?.type === "Identifier";

const isDirectCall = (path, argumentCount) => {
	const call = path.parent?.node;
	return (
		call?.type === "CallExpression" &&
		call.callee === path.node &&
		!call.optional &&
		call.arguments.length === argumentCount &&
		call.arguments.every((argument) => argument.type !== "SpreadElement")
	);
};

const getNamedImportBindings = (root, j, imported) => {
	const bindings = [];
	for (const declarationPath of root.find(j.ImportDeclaration, { source: { value: "effect" } }).paths()) {
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			if (
				specifierPath.node.type !== "ImportSpecifier" ||
				getImportedName(specifierPath.node) !== imported
			) {
				continue;
			}
			const binding = getImportBinding(specifierPath.get("local"));
			if (binding) {
				bindings.push(binding);
			}
		}
	}
	return bindings;
};

const isBindingVisible = (binding, sites) =>
	sites.every(
		(site) =>
			!isTypeParameterShadowed(site, binding.local) &&
			site.scope?.lookup(binding.local) === binding.scope,
	);

const getFreshLocal = (root, j, imported, sites) => {
	let suffix = 0;
	while (true) {
		const local =
			suffix === 0
				? imported
				: suffix === 1
					? imported === "Context"
						? "EffectContext"
						: "EffectRuntime"
					: imported === "Context"
						? `EffectContext${suffix}`
						: `EffectRuntime${suffix}`;
		suffix += 1;
		if (
			root.find(j.Identifier, { name: local }).size() === 0 &&
			sites.every(
				(site) => !site.scope?.lookup(local) && !isTypeParameterShadowed(site, local),
			)
		) {
			return local;
		}
	}
};

const canAddImport = (path, kind) =>
	path.node.source.value === "effect" &&
	(kind === "type" || path.node.importKind !== "type") &&
	!path.node.assertions?.length &&
	!path.node.attributes?.length &&
	path.node.specifiers?.every((specifier) => specifier.type === "ImportSpecifier");

const getImportTarget = (root, j, kind, preferredBindings) => {
	const declarationPaths = root.find(j.ImportDeclaration, { source: { value: "effect" } }).paths();
	const preferredPaths = preferredBindings.map((binding) => binding.declarationPath);
	return [...preferredPaths, ...declarationPaths].find(
		(path, index, paths) =>
			paths.findIndex((candidate) => candidate.node === path.node) === index && canAddImport(path, kind),
	);
};

const getImportPlan = (root, j, imported, kind, sites, preferredBindings, fail) => {
	const existing = getNamedImportBindings(root, j, imported).find(
		(binding) =>
			(kind === "type" || binding.kind === "value") && isBindingVisible(binding, sites),
	);
	if (existing) {
		return { action: "reuse", ...existing };
	}

	const targetPath = getImportTarget(root, j, kind, preferredBindings);
	if (!targetPath) {
		fail(`cannot add ${kind} import ${imported} from effect`);
		return;
	}
	const anchor = preferredBindings.find(
		(binding) => binding.declarationPath.node === targetPath.node,
	)?.specifier;
	return {
		action: "add",
		anchor,
		imported,
		kind,
		local: getFreshLocal(root, j, imported, sites),
		targetPath,
	};
};

const applyImportPlan = (j, plan) => {
	if (plan.action === "reuse") {
		return plan;
	}
	const specifier = j.importSpecifier(
		j.identifier(plan.imported),
		plan.local === plan.imported ? null : j.identifier(plan.local),
	);
	if (plan.kind === "type" && plan.targetPath.node.importKind !== "type") {
		specifier.importKind = "type";
	}
	const specifiers = plan.targetPath.node.specifiers;
	const index = plan.anchor ? specifiers.indexOf(plan.anchor) : -1;
	specifiers.splice(index < 0 ? specifiers.length : index, 0, specifier);
	return { ...plan, declarationPath: plan.targetPath, specifier };
};

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) {
			to[key] = [...(to[key] ?? []), ...from[key]];
		}
	}
};

export default function runtimeContext(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[runtime-context] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const effectPlans = [];
	const runnerPlans = [];
	const runtimeGroups = new Map();
	const typePlans = [];
	let failure;

	const fail = (reason) => {
		failure ??= reason;
	};
	const addRuntimeTarget = (binding, identifier, kind) => {
		const group = runtimeGroups.get(binding.specifier) ?? {
			binding,
			kinds: new Set(),
			targets: new Set(),
		};
		group.kinds.add(kind);
		group.targets.add(identifier);
		runtimeGroups.set(binding.specifier, group);
	};

	for (const path of root.find(j.Identifier).paths()) {
		if (hasImportAncestor(path)) {
			continue;
		}
		const binding = getImportBinding(path);
		const targets = binding && DIRECT_IMPORT_TARGETS.get(binding.source);
		if (
			binding?.specifier.type === "ImportSpecifier" &&
			binding.imported &&
			targets?.has(binding.imported)
		) {
			fail(`unsupported direct import ${binding.source}.${binding.imported}`);
			break;
		}
	}

	const memberPaths = root
		.find(j.Node)
		.paths()
		.filter((path) =>
			["MemberExpression", "OptionalMemberExpression", "TSQualifiedName"].includes(
				path.node.type,
			),
		);
	for (const path of memberPaths) {
		const node = path.node;
		const identifierPath =
			node.type === "TSQualifiedName"
				? node.left?.type === "Identifier"
					? path.get("left")
					: undefined
				: node.object?.type === "Identifier"
					? path.get("object")
					: undefined;
		if (!identifierPath) {
			continue;
		}

		const binding = getImportBinding(identifierPath);
		const member = getMemberName(node);
		const directNamespace =
			binding?.specifier.type === "ImportNamespaceSpecifier" &&
			((binding.source === "effect/Effect" && member === "runtime") ||
				(binding.source === "effect/Runtime" &&
					(member === "Runtime" || RUNNER_RENAMES.has(member))));
		if (directNamespace) {
			fail(`unsupported direct import ${binding.source}.${member}`);
			continue;
		}
		if (
			binding?.specifier.type !== "ImportSpecifier" ||
			binding.source !== "effect" ||
			!binding.imported ||
			!member
		) {
			continue;
		}

		if (binding.imported === "Effect" && member === "runtime") {
			const call = path.parent?.node;
			const typeParameters = call && getTypeParameters(call);
			if (
				binding.kind !== "value" ||
				!isOrdinaryMember(node) ||
				!isDirectCall(path, 0) ||
				(typeParameters && typeParameters.params.length !== 1)
			) {
				fail("unsupported Effect.runtime usage");
				continue;
			}
			effectPlans.push({ path });
			continue;
		}

		if (binding.imported !== "Runtime") {
			continue;
		}
		if (member === "Runtime") {
			const reference = path.parent?.node;
			const typeParameters = reference && getTypeParameters(reference);
			if (
				node.type !== "TSQualifiedName" ||
				reference?.type !== "TSTypeReference" ||
				reference.typeName !== node ||
				typeParameters?.params.length !== 1
			) {
				fail("unsupported Runtime.Runtime usage");
				continue;
			}
			typePlans.push({ binding, path });
			addRuntimeTarget(binding, identifierPath.node, "type");
			continue;
		}

		const replacement = RUNNER_RENAMES.get(member);
		if (!replacement) {
			continue;
		}
		const call = path.parent?.node;
		if (
			binding.kind !== "value" ||
			!isOrdinaryMember(node) ||
			!isDirectCall(path, 1) ||
			getTypeParameters(call)
		) {
			fail(`unsupported Runtime.${member} usage`);
			continue;
		}
		runnerPlans.push({ binding, path, replacement });
		addRuntimeTarget(binding, identifierPath.node, "runner");
	}

	if (failure) {
		api.report(`[runtime-context] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!effectPlans.length && !runnerPlans.length && !typePlans.length) {
		return;
	}

	let contextImport;
	let effectImport;
	if (typePlans.length) {
		contextImport = getImportPlan(
			root,
			j,
			"Context",
			"type",
			typePlans.map((plan) => plan.path),
			typePlans.map((plan) => plan.binding),
			fail,
		);
	}
	if (runnerPlans.length) {
		effectImport = getImportPlan(
			root,
			j,
			"Effect",
			"value",
			runnerPlans.map((plan) => plan.path),
			runnerPlans.map((plan) => plan.binding),
			fail,
		);
	}
	if (failure) {
		api.report(`[runtime-context] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}

	for (const group of runtimeGroups.values()) {
		const references = getReferences(root, j, group.binding);
		group.remove =
			Boolean(references?.length) && references.every((path) => group.targets.has(path.node));
	}

	if (contextImport) {
		contextImport = applyImportPlan(j, contextImport);
	}
	if (effectImport) {
		effectImport = applyImportPlan(j, effectImport);
	}
	for (const plan of effectPlans) {
		plan.path.node.property.name = "context";
	}
	for (const plan of runnerPlans) {
		plan.path.node.object.name = effectImport.local;
		plan.path.node.property.name = plan.replacement;
	}
	for (const plan of typePlans) {
		plan.path.node.left.name = contextImport.local;
		plan.path.node.right.name = "Context";
	}

	const removals = new Map();
	for (const group of runtimeGroups.values()) {
		if (!group.remove) {
			continue;
		}
		const replacementImport = group.kinds.has("runner") ? effectImport : contextImport;
		copyComments(group.binding.specifier, replacementImport.specifier);
		const declarationRemovals = removals.get(group.binding.declarationPath.node) ?? {
			path: group.binding.declarationPath,
			specifiers: new Set(),
		};
		declarationRemovals.specifiers.add(group.binding.specifier);
		removals.set(group.binding.declarationPath.node, declarationRemovals);
	}
	for (const removal of removals.values()) {
		removal.path.node.specifiers = removal.path.node.specifiers.filter(
			(specifier) => !removal.specifiers.has(specifier),
		);
		if (!removal.path.node.specifiers.length) {
			const target = [effectImport, contextImport].find(
				(plan) => plan && plan.declarationPath.node !== removal.path.node,
			);
			if (target) {
				copyComments(removal.path.node, target.declarationPath.node);
			}
			removal.path.prune();
		}
	}

	api.report(`[runtime-context] transformed ${repositoryPath}`);
	return root.toSource();
}
