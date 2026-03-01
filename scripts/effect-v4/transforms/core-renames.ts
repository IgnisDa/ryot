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

const EFFECT_SOURCES = new Set(["effect", "@ryot/sandbox-sdk/effect"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();
const EFFECT_TYPE_EXTRACTORS = new Set(["Error", "Success"]);

const MEMBER_RENAMES = new Map([
	["Effect.catchAll", "catch"],
	["Effect.catchAllCause", "catchCause"],
	["Effect.zipRight", "andThen"],
	["Effect.fork", "forkChild"],
	["Effect.tapErrorCause", "tapCause"],
	["Cause.failureOption", "findErrorOption"],
	["Cause.isInterrupted", "hasInterrupts"],
	["Cause.isInterruptedOnly", "hasInterruptsOnly"],
	["Exit.isInterrupted", "hasInterrupts"],
	["Context.unsafeMake", "makeUnsafe"],
	["DateTime.lessThan", "isLessThan"],
	["DateTime.unsafeFromDate", "fromDateUnsafe"],
	["DateTime.unsafeMake", "makeUnsafe"],
	["DateTime.unsafeNow", "nowUnsafe"],
	["Deferred.unsafeDone", "doneUnsafe"],
	["Option.fromNullable", "fromNullishOr"],
	["Scope.extend", "provide"],
	["Layer.scopedDiscard", "effectDiscard"],
	["Layer.unwrapEffect", "unwrap"],
	["Layer.scoped", "effect"],
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

const getAncestorPath = (path, type) => {
	for (let parent = path; parent; parent = parent.parent) {
		if (parent.node?.type === type) {
			return parent;
		}
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
	const scope = local && identifierPath.scope?.lookup(local);
	const bindings = scope?.getBindings()[local];
	if (!scope || bindings?.length !== 1) {
		return;
	}

	const path = bindings[0];
	const declaration = getAncestorPath(path, "ImportDeclaration")?.node;
	const specifier = path.parent?.node;
	if (!declaration || !specifier || specifier.local !== path.node) {
		return;
	}

	return {
		declaration,
		imported: getImportedName(specifier),
		kind: getImportKind(declaration, specifier),
		source: declaration.source.value,
		specifier,
	};
};

const getMemberName = (node) => {
	if (node.property?.type === "Identifier") {
		return node.property.name;
	}
	if (
		(node.property?.type === "StringLiteral" || node.property?.type === "Literal") &&
		typeof node.property.value === "string"
	) {
		return node.property.value;
	}
};

const getLayerContextIdentifier = (path) => {
	const name = path.node.typeName;
	if (
		name?.type === "TSQualifiedName" &&
		name.left?.type === "TSQualifiedName" &&
		name.left.left?.type === "Identifier" &&
		name.left.right?.type === "Identifier" &&
		name.left.right.name === "Layer" &&
		name.right?.type === "Identifier" &&
		name.right.name === "Context"
	) {
		return path.get("typeName", "left", "left");
	}
};

const getEffectTypeExtractor = (path) => {
	const name = path.node;
	if (
		name.type === "TSQualifiedName" &&
		name.left?.type === "TSQualifiedName" &&
		name.left.left?.type === "Identifier" &&
		name.left.right?.type === "Identifier" &&
		name.left.right.name === "Effect" &&
		name.right?.type === "Identifier" &&
		EFFECT_TYPE_EXTRACTORS.has(name.right.name)
	) {
		return {
			extractor: name.right.name,
			identifierPath: path.get("left", "left"),
		};
	}
};

const getComputedEffectTypeExtractor = (path) => {
	const node = path.node;
	const name = node.objectType?.typeName;
	const literal = node.indexType?.literal;
	if (
		node.type === "TSIndexedAccessType" &&
		node.objectType?.type === "TSTypeReference" &&
		name?.type === "TSQualifiedName" &&
		name.left?.type === "Identifier" &&
		name.right?.type === "Identifier" &&
		name.right.name === "Effect" &&
		(literal?.type === "StringLiteral" || literal?.type === "Literal") &&
		typeof literal.value === "string" &&
		EFFECT_TYPE_EXTRACTORS.has(literal.value)
	) {
		return {
			extractor: literal.value,
			identifierPath: path.get("objectType", "typeName", "left"),
		};
	}
};

const prependComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) {
			to[key] = [...from[key], ...(to[key] ?? [])];
		}
	}
};

export default function coreRenames(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[core-renames] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const memberPlans = [];
	const typePlans = [];
	let failure;

	const fail = (reason) => {
		failure ??= reason;
	};

	const memberPaths = root
		.find(j.Node)
		.paths()
		.filter(
			(path) =>
				path.node.type === "MemberExpression" || path.node.type === "OptionalMemberExpression",
		);
	for (const path of memberPaths) {
		if (path.node.object?.type !== "Identifier") {
			continue;
		}
		const binding = getImportBinding(path.get("object"));
		if (
			binding?.specifier.type !== "ImportSpecifier" ||
			!EFFECT_SOURCES.has(binding.source) ||
			!binding.imported
		) {
			continue;
		}

		const member = getMemberName(path.node);
		const replacement = member && MEMBER_RENAMES.get(`${binding.imported}.${member}`);
		if (!replacement) {
			continue;
		}
		if (
			binding.kind !== "value" ||
			path.node.type !== "MemberExpression" ||
			path.node.computed ||
			path.node.optional ||
			path.node.property?.type !== "Identifier"
		) {
			fail(`unsupported member syntax ${binding.imported}.${member}`);
			continue;
		}
		memberPlans.push({ path, replacement });
	}

	for (const path of root.find(j.TSQualifiedName).paths()) {
		const target = getEffectTypeExtractor(path);
		if (!target) {
			continue;
		}
		const binding = getImportBinding(target.identifierPath);
		if (
			binding?.specifier.type !== "ImportSpecifier" ||
			binding.imported !== "Effect" ||
			!EFFECT_SOURCES.has(binding.source)
		) {
			continue;
		}

		const referencePath = path.parent;
		const parameters = referencePath.node.typeArguments ?? referencePath.node.typeParameters;
		if (
			referencePath.node.type !== "TSTypeReference" ||
			referencePath.node.typeName !== path.node ||
			parameters?.params.length !== 1
		) {
			fail(`unsupported Effect.Effect.${target.extractor} type extractor`);
			continue;
		}
		typePlans.push({
			identifier: target.identifierPath.node,
			path: referencePath,
			removed: path.node.left.right,
			replacement: target.extractor,
		});
	}

	for (const path of root.find(j.TSIndexedAccessType).paths()) {
		const target = getComputedEffectTypeExtractor(path);
		if (!target) {
			continue;
		}
		const binding = getImportBinding(target.identifierPath);
		if (
			binding?.specifier.type === "ImportSpecifier" &&
			binding.imported === "Effect" &&
			EFFECT_SOURCES.has(binding.source)
		) {
			fail(`unsupported Effect.Effect.${target.extractor} type extractor`);
		}
	}

	for (const path of root.find(j.TSTypeReference).paths()) {
		const identifierPath = getLayerContextIdentifier(path);
		if (!identifierPath) {
			continue;
		}
		const binding = getImportBinding(identifierPath);
		if (!binding) {
			continue;
		}

		const namedLayer =
			binding.specifier.type === "ImportSpecifier" &&
			EFFECT_SOURCES.has(binding.source) &&
			binding.imported === "Layer";
		const typeNamespace =
			binding.specifier.type === "ImportNamespaceSpecifier" &&
			binding.source === "effect/Layer" &&
			binding.kind === "type";
		if (namedLayer || typeNamespace) {
			typePlans.push({ identifier: identifierPath.node, path, replacement: "Services" });
		} else if (binding.source === "effect/Layer") {
			fail(`unsupported Layer.Layer.Context binding ${identifierPath.node.name}`);
		}
	}

	if (failure) {
		api.report(`[core-renames] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!memberPlans.length && !typePlans.length) {
		return;
	}

	for (const plan of memberPlans) {
		plan.path.node.property.name = plan.replacement;
	}
	for (const plan of typePlans) {
		if (plan.removed) {
			prependComments(plan.removed, plan.path.node.typeName.right);
		}
		plan.path.node.typeName.left = plan.identifier;
		plan.path.node.typeName.right.name = plan.replacement;
	}

	api.report(`[core-renames] transformed ${repositoryPath}`);
	return root.toSource();
}
