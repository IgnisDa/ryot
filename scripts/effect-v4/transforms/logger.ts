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

const LOG_LEVEL_LITERALS = new Map([
	["All", "All"],
	["Debug", "Debug"],
	["Error", "Error"],
	["Fatal", "Fatal"],
	["Info", "Info"],
	["None", "None"],
	["Trace", "Trace"],
	["Warning", "Warn"],
]);
const LOGGER_TARGETS = new Set([
	"logfmtLogger",
	"minimumLogLevel",
	"prettyLogger",
	"replace",
	"replaceScoped",
	"zip",
]);
const LOG_LEVEL_TARGETS = new Set([...LOG_LEVEL_LITERALS.keys(), "lessThanEqual"]);

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

const hasImportAncestor = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (parent.node.type === "ImportDeclaration") {
			return true;
		}
	}
	return false;
};

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

const isOrdinaryMember = (node) =>
	node.type === "MemberExpression" &&
	!node.computed &&
	!node.optional &&
	node.property?.type === "Identifier";

const getDirectCall = (memberPath, argumentCount) => {
	const callPath = memberPath.parent;
	const call = callPath?.node;
	if (
		call?.type !== "CallExpression" ||
		call.callee !== memberPath.node ||
		call.optional ||
		call.arguments.length !== argumentCount ||
		call.arguments.some((argument) => argument.type === "SpreadElement") ||
		call.typeArguments ||
		call.typeParameters
	) {
		return;
	}
	return callPath;
};

const isSameImportedMember = (memberPath, binding, member) => {
	if (!memberPath || !isOrdinaryMember(memberPath.node) || memberPath.node.property.name !== member) {
		return false;
	}
	const objectPath = memberPath.get("object");
	if (objectPath.node?.type !== "Identifier") {
		return false;
	}
	return getImportBinding(objectPath)?.specifier === binding.specifier;
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
	const aliases =
		imported === "Layer"
			? ["Layer", "EffectLayer"]
			: imported === "References"
				? ["References", "EffectReferences"]
				: [imported];
	let suffix = 2;
	while (true) {
		const local = aliases.shift() ?? `${imported}${suffix++}`;
		if (
			root.find(j.Identifier, { name: local }).size() === 0 &&
			sites.every((site) => !site.scope?.lookup(local) && !isTypeParameterShadowed(site, local))
		) {
			return local;
		}
	}
};

const canAddImport = (path) =>
	path.node.source.value === "effect" &&
	path.node.importKind !== "type" &&
	!path.node.assertions?.length &&
	!path.node.attributes?.length &&
	path.node.specifiers?.every((specifier) => specifier.type === "ImportSpecifier");

const getImportPlan = (root, j, imported, sites, preferredBindings, fail) => {
	const existing = getNamedImportBindings(root, j, imported).find(
		(binding) => binding.kind === "value" && isBindingVisible(binding, sites),
	);
	if (existing) {
		return { action: "reuse", ...existing };
	}

	const preferredPaths = preferredBindings.map((binding) => binding.declarationPath);
	const declarationPaths = root.find(j.ImportDeclaration, { source: { value: "effect" } }).paths();
	const targetPath = [...preferredPaths, ...declarationPaths].find(
		(path, index, paths) =>
			paths.findIndex((candidate) => candidate.node === path.node) === index && canAddImport(path),
	);
	if (!targetPath) {
		fail(`cannot add value import ${imported} from effect`);
		return;
	}

	return {
		action: "add",
		imported,
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
	plan.targetPath.node.specifiers.push(specifier);
	return { ...plan, declarationPath: plan.targetPath, specifier };
};

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) {
			to[key] = [...(to[key] ?? []), ...from[key]];
		}
	}
};

const makeLoggerMember = (j, local, member) =>
	j.memberExpression(j.identifier(local), j.identifier(member));

const pruneLogLevelImports = (bindingPlans, firstReplacement) => {
	for (const plan of bindingPlans) {
		if (
			plan.binding.imported !== "LogLevel" ||
			!plan.eliminated.size ||
			plan.references.some((reference) => !plan.eliminated.has(reference.node))
		) {
			continue;
		}

		const declaration = plan.binding.declarationPath.node;
		const index = declaration.specifiers.indexOf(plan.binding.specifier);
		const remaining = declaration.specifiers.filter(
			(specifier) => specifier !== plan.binding.specifier,
		);
		const commentTarget = remaining[index] ?? remaining[index - 1] ?? firstReplacement;
		if (commentTarget) {
			copyComments(plan.binding.specifier, commentTarget);
		}
		declaration.specifiers = remaining;
		if (!remaining.length) {
			if (firstReplacement) {
				copyComments(declaration, firstReplacement);
			}
			plan.binding.declarationPath.prune();
		}
	}
};

export default function logger(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[logger] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const bindingPlans = [];
	const callPlans = [];
	const memberPlans = [];
	let failure;

	const fail = (reason) => {
		failure ??= reason;
	};

	for (const imported of ["Logger", "LogLevel"]) {
		for (const binding of getNamedImportBindings(root, j, imported)) {
			const references = getReferences(root, j, binding);
			if (!references) {
				fail(`unsupported ${imported} import binding ${binding.local}`);
				continue;
			}
			const bindingPlan = { binding, eliminated: new Set(), references };
			bindingPlans.push(bindingPlan);

			for (const reference of references) {
				const memberPath = reference.parent;
				const memberNode = memberPath?.node;
				const owned =
					(memberNode?.type === "MemberExpression" ||
						memberNode?.type === "OptionalMemberExpression") &&
					memberNode.object === reference.node
						? true
						: memberNode?.type === "TSQualifiedName" && memberNode.left === reference.node;
				if (!owned) {
					continue;
				}

				const member = getMemberName(memberNode);
				const targets = imported === "Logger" ? LOGGER_TARGETS : LOG_LEVEL_TARGETS;
				if (!member || !targets.has(member)) {
					continue;
				}
				if (binding.kind !== "value" || !isOrdinaryMember(memberNode)) {
					fail(`unsupported ${imported}.${member} usage`);
					continue;
				}

				if (imported === "LogLevel") {
					const literal = LOG_LEVEL_LITERALS.get(member);
					if (literal) {
						memberPlans.push({ kind: "literal", literal, path: memberPath });
						bindingPlan.eliminated.add(reference.node);
						continue;
					}
					if (!getDirectCall(memberPath, 2)) {
						fail("unsupported LogLevel.lessThanEqual usage");
						continue;
					}
					memberPlans.push({ kind: "rename", name: "isLessThanOrEqualTo", path: memberPath });
					continue;
				}

				if (member === "logfmtLogger") {
					memberPlans.push({ kind: "rename", name: "formatLogFmt", path: memberPath });
					continue;
				}

				const argumentCount =
					member === "prettyLogger" ? 0 : member === "minimumLogLevel" ? 1 : 2;
				const callPath = getDirectCall(memberPath, argumentCount);
				if (!callPath) {
					fail(`unsupported Logger.${member} usage`);
					continue;
				}
				if (member === "prettyLogger") {
					memberPlans.push({ kind: "rename", name: "consolePretty", path: memberPath });
					continue;
				}
				if (member === "replace" || member === "replaceScoped") {
					if (
						!isSameImportedMember(callPath.get("arguments", 0), binding, "defaultLogger") ||
						(member === "replace" && callPath.node.arguments[1].type !== "Identifier")
					) {
						fail(`unsupported Logger.${member} usage`);
						continue;
					}
				}
				if (
					member === "zip" &&
					(callPath.node.arguments.some((argument) => argument.type !== "Identifier") ||
						callPath.node.arguments.some((argument) => argument.name === "options"))
				) {
					fail("unsupported Logger.zip usage");
					continue;
				}
				callPlans.push({ binding, callPath, kind: member, memberPath });
			}
		}
	}

	if (failure) {
		api.report(`[logger] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}

	const minimumPlans = callPlans.filter((plan) => plan.kind === "minimumLogLevel");
	let layerImport;
	let referencesImport;
	if (minimumPlans.length) {
		const sites = minimumPlans.map((plan) => plan.memberPath);
		const preferredBindings = minimumPlans.map((plan) => plan.binding);
		layerImport = getImportPlan(root, j, "Layer", sites, preferredBindings, fail);
		referencesImport = getImportPlan(root, j, "References", sites, preferredBindings, fail);
	}
	if (failure) {
		api.report(`[logger] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}

	const count = memberPlans.length + callPlans.length;
	if (!count) {
		return;
	}

	if (layerImport) {
		layerImport = applyImportPlan(j, layerImport);
		referencesImport = applyImportPlan(j, referencesImport);
	}

	let firstReplacement;
	for (const plan of memberPlans) {
		if (plan.kind === "rename") {
			plan.path.node.property.name = plan.name;
			firstReplacement ??= plan.path.node;
			continue;
		}
		const replacement = j.stringLiteral(plan.literal);
		copyComments(plan.path.node, replacement);
		plan.path.replace(replacement);
		firstReplacement ??= replacement;
	}

	for (const plan of callPlans) {
		const loggerLocal = plan.binding.local;
		const args = plan.callPath.node.arguments;
		let replacement;
		if (plan.kind === "minimumLogLevel") {
			replacement = j.callExpression(
				j.memberExpression(j.identifier(layerImport.local), j.identifier("succeed")),
				[
					j.memberExpression(
						j.identifier(referencesImport.local),
						j.identifier("MinimumLogLevel"),
					),
					args[0],
				],
			);
		} else if (plan.kind === "replace" || plan.kind === "replaceScoped") {
			replacement = j.callExpression(makeLoggerMember(j, loggerLocal, "layer"), [
				j.arrayExpression([args[1], makeLoggerMember(j, loggerLocal, "tracerLogger")]),
			]);
		} else {
			const options = j.identifier("options");
			replacement = j.callExpression(makeLoggerMember(j, loggerLocal, "make"), [
				j.arrowFunctionExpression(
					[options],
					j.arrayExpression(
						args.map((argument) =>
							j.callExpression(j.memberExpression(argument, j.identifier("log")), [
								j.identifier("options"),
							]),
						),
					),
				),
			]);
		}
		copyComments(plan.callPath.node, replacement);
		copyComments(plan.memberPath.node, replacement.callee);
		plan.callPath.replace(replacement);
		firstReplacement ??= replacement;
	}

	pruneLogLevelImports(bindingPlans, firstReplacement);
	api.report(
		`[logger] transformed ${repositoryPath} (${count} occurrence${count === 1 ? "" : "s"})`,
	);
	return root.toSource({ arrowParensAlways: true });
}
