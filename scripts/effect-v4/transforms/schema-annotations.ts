import { basename, dirname, relative, resolve, sep } from "node:path";

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

const EFFECT_SOURCES = new Set([
	"effect",
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/workflow",
]);
const SCHEMA_FACTORIES = new Set(["Struct", "Union", "suspend"]);
const SCHEMA_VALUES = new Set(["Boolean", "Number", "String", "Unknown"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();

const getRepositoryPath = (path) => {
	const absolutePath = resolve(REPOSITORY_ROOT, path);
	const repositoryPath = relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
	const scopeRoot = SCOPE_ROOTS.find(
		(root) => repositoryPath === root || repositoryPath.startsWith(`${root}/`),
	);
	if (!scopeRoot || GENERATED_FILES.has(basename(repositoryPath))) return;

	const scopedParts = repositoryPath.slice(scopeRoot.length + 1).split("/");
	if (scopedParts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return;
	return repositoryPath;
};

const getAncestorPath = (path, type) => {
	for (let parent = path; parent; parent = parent.parent) {
		if (parent.node?.type === type) return parent;
	}
};

const getImportBinding = (identifierPath) => {
	const local = identifierPath.node?.name;
	if (!local) return;

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || bindings?.length !== 1) return;

		const path = bindings[0];
		const declaration = getAncestorPath(path, "ImportDeclaration")?.node;
		const specifier = path.parent?.node;
		if (!declaration || !specifier || specifier.local !== path.node) return;

		return {
			imported: specifier.imported?.name ?? specifier.imported?.value,
			kind:
				declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value",
			source: declaration.source.value,
			specifier,
		};
	} catch {
		return;
	}
};

const isEffectSource = (source, repositoryPath) =>
	EFFECT_SOURCES.has(source) ||
	(source === "./effect" && repositoryPath.startsWith("libs/sandbox-sdk/src/"));

const isOwnedSchemaNamespace = (path, repositoryPath) => {
	const binding = getImportBinding(path);
	return (
		binding?.kind === "value" &&
		binding.specifier.type === "ImportSpecifier" &&
		binding.imported === "Schema" &&
		isEffectSource(binding.source, repositoryPath)
	);
};

const isStrictStructFactory = (path, repositoryPath) => {
	const binding = getImportBinding(path);
	return (
		binding?.kind === "value" &&
		binding.specifier.type === "ImportSpecifier" &&
		binding.imported === "strictStruct" &&
		resolve(REPOSITORY_ROOT, dirname(repositoryPath), binding.source) ===
			resolve(REPOSITORY_ROOT, "libs/contract/src/schema/utils")
	);
};

const isOwnedSchemaExpression = (path, repositoryPath, seen = new Set()) => {
	const node = path.node;
	if (!node || seen.has(node)) return false;
	seen.add(node);

	if (node.type === "Identifier") {
		try {
			const scope = path.scope?.lookup(node.name);
			const bindings = scope?.getBindings()[node.name];
			if (!scope || bindings?.length !== 1) return false;
			const declarator = bindings[0].parent;
			if (declarator?.node?.type !== "VariableDeclarator" || declarator.node.id !== bindings[0].node) {
				return false;
			}
			if (getAncestorPath(declarator, "VariableDeclaration")?.node?.kind !== "const") return false;
			return isOwnedSchemaExpression(declarator.get("init"), repositoryPath, seen);
		} catch {
			return false;
		}
	}

	if (node.type === "MemberExpression") {
		return (
			!node.computed &&
			!node.optional &&
			node.object?.type === "Identifier" &&
			node.property?.type === "Identifier" &&
			SCHEMA_VALUES.has(node.property.name) &&
			isOwnedSchemaNamespace(path.get("object"), repositoryPath)
		);
	}

	if (node.type !== "CallExpression" || node.optional) return false;
	if (node.callee?.type === "Identifier") {
		return isStrictStructFactory(path.get("callee"), repositoryPath);
	}
	if (
		node.callee?.type !== "MemberExpression" ||
		node.callee.computed ||
		node.callee.optional ||
		node.callee.property?.type !== "Identifier"
	) {
		return false;
	}
	if (
		node.callee.object?.type === "Identifier" &&
		SCHEMA_FACTORIES.has(node.callee.property.name) &&
		isOwnedSchemaNamespace(path.get("callee", "object"), repositoryPath)
	) {
		return true;
	}
	return (
		node.callee.property.name === "pipe" &&
		isOwnedSchemaExpression(path.get("callee", "object"), repositoryPath, seen)
	);
};

const getPropertyName = (member) => {
	if (!member.computed && member.property?.type === "Identifier") return member.property.name;
	if (
		member.computed &&
		(member.property?.type === "StringLiteral" || member.property?.type === "Literal")
	) {
		return member.property.value;
	}
};

export default function schemaAnnotations(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-annotations] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const plans = [];
	let failure;

	for (const path of root.find(j.Node).paths()) {
		const member = path.node;
		if (
			(member.type !== "MemberExpression" && member.type !== "OptionalMemberExpression") ||
			getPropertyName(member) !== "annotations"
		) {
			continue;
		}

		const namespace =
			member.object?.type === "Identifier" &&
			isOwnedSchemaNamespace(path.get("object"), repositoryPath);
		if (!namespace && !isOwnedSchemaExpression(path.get("object"), repositoryPath)) continue;

		const call = path.parent?.node;
		if (member.computed) {
			failure ??= "unsupported computed Schema.annotations";
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= "unsupported optional Schema.annotations";
		} else if (
			call?.type !== "CallExpression" ||
			call.callee !== member ||
			call.arguments.length !== 1 ||
			call.arguments[0].type === "SpreadElement"
		) {
			failure ??= "unsupported Schema.annotations arity";
		} else if (
			!namespace &&
			(call.typeArguments?.length || call.typeParameters?.params?.length)
		) {
			failure ??= "unsupported Schema.annotations type arguments";
		} else {
			plans.push({ member, namespace });
		}
	}

	if (failure) {
		api.report(`[schema-annotations] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	let namespace = 0;
	for (const plan of plans) {
		plan.member.property.name = "annotate";
		if (plan.namespace) namespace += 1;
	}

	api.report(
		`[schema-annotations] transformed ${repositoryPath} (${plans.length} occurrences: namespace ${namespace}, instance ${plans.length - namespace})`,
	);
	return root.toSource();
}
