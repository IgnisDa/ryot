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
const SUPPORT_PATH = "tests/src/support/effect-test.ts";
const TEST_SOURCES = new Set(["@effect/vitest", "~/support/effect-test"]);

const OLD_SUPPORT_COMMENT = `*
 * The only sanctioned runner surface for \`tests/src/tests/**\`. \`it.effect\` (and the other
 * TestClock-/per-file-layer-bearing variants) are withheld at the type level: \`it.effect\` installs
 * the Effect \`TestClock\`, which deadlocks the real-time waits these E2E suites depend on. Use
 * \`it.live\` (no \`Scope\`) or \`it.scopedLive\` (per-test \`Scope\` for \`Effect.acquireRelease\`).
 `;
const NEW_SUPPORT_COMMENT = `*
 * The only sanctioned runner surface for \`tests/src/tests/**\`. \`it.effect\` and the other
 * TestClock-/per-file-layer-bearing variants are withheld at the type level: \`it.effect\` installs
 * the Effect \`TestClock\`, which deadlocks the real-time waits these E2E suites depend on.
 * \`it.live\` provides a per-test \`Scope\` for \`Effect.acquireRelease\` without \`TestClock\`.
 `;

const METHOD_RENAMES = new Map([
	["scoped", "effect"],
	["scopedLive", "live"],
]);

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

const getBinding = (identifierPath) => {
	const local = identifierPath.node?.name;
	const scope = local && identifierPath.scope?.lookup(local);
	const bindings = scope?.getBindings()[local];
	if (!scope || bindings?.length !== 1) {
		return;
	}
	return { path: bindings[0], scope };
};

const getImportBinding = (identifierPath) => {
	const binding = getBinding(identifierPath);
	const declaration = binding && getAncestorPath(binding.path, "ImportDeclaration")?.node;
	const specifier = binding?.path.parent?.node;
	if (!declaration || !specifier || specifier.local !== binding.path.node) {
		return;
	}

	return {
		...binding,
		declaration,
		imported: getImportedName(specifier),
		kind: getImportKind(declaration, specifier),
		source: declaration.source.value,
		specifier,
	};
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

const getReferences = (root, j, local, scope) =>
	root
		.find(j.Identifier, { name: local })
		.paths()
		.filter((path) => isReferenceIdentifier(path) && path.scope?.lookup(local) === scope);

const isStringLiteral = (node, value) =>
	(node?.type === "StringLiteral" || node?.type === "Literal") && node.value === value;

const getPropertyName = (node) => {
	if (node.computed) {
		return;
	}
	if (node.property?.type === "Identifier") {
		return node.property.name;
	}
	if (node.key?.type === "Identifier") {
		return node.key.name;
	}
	if (isStringLiteral(node.key, node.key?.value)) {
		return node.key.value;
	}
};

const isPlainProperty = (node, name) =>
	(node?.type === "ObjectProperty" || node?.type === "Property") &&
	!node.computed &&
	!node.method &&
	!node.shorthand &&
	node.key?.type === "Identifier" &&
	node.key.name === name;

const isNamedImport = (identifierPath, source, imported) => {
	const binding = getImportBinding(identifierPath);
	return (
		binding?.specifier.type === "ImportSpecifier" &&
		binding.source === source &&
		binding.imported === imported &&
		binding.kind === "value"
	);
};

const collectComments = (root, j) => {
	const comments = [];
	const seen = new Set();
	root.find(j.Node).forEach((path) => {
		for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
			for (const comment of path.node[key] ?? []) {
				if (!seen.has(comment)) {
					seen.add(comment);
					comments.push(comment);
				}
			}
		}
	});
	return comments;
};

export default function vitest(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[vitest] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	let failure: string | undefined;
	const fail = (reason: string) => {
		failure ??= reason;
	};

	const equalityDeclarations = new Map();
	const equalityStatements = new Map();
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (declarationPath.node.source.value !== "@effect/vitest") {
			continue;
		}

		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			if (
				specifierPath.node.type !== "ImportSpecifier" ||
				getImportedName(specifierPath.node) !== "addEqualityTesters"
			) {
				continue;
			}

			const localPath = specifierPath.get("local");
			const local = localPath.node?.name;
			const binding = local && getBinding(localPath);
			if (
				!local ||
				!binding ||
				binding.path.node !== specifierPath.node.local ||
				getImportKind(declarationPath.node, specifierPath.node) !== "value"
			) {
				fail("unsupported addEqualityTesters binding");
				continue;
			}

			const references = getReferences(root, j, local, binding.scope);
			for (const reference of references) {
				const callPath = reference.parent;
				const statementPath = callPath?.parent;
				if (
					callPath?.node.type !== "CallExpression" ||
					callPath.node.callee !== reference.node ||
					callPath.node.arguments.length !== 0 ||
					callPath.node.optional ||
					callPath.node.typeArguments ||
					callPath.node.typeParameters ||
					statementPath?.node.type !== "ExpressionStatement" ||
					statementPath.node.expression !== callPath.node
				) {
					fail(`unsupported addEqualityTesters usage for ${local}`);
					continue;
				}
				equalityStatements.set(statementPath.node, statementPath);
			}
			equalityDeclarations.set(declarationPath.node, declarationPath);
		}
	}

	for (const memberPath of root.find(j.MemberExpression).paths()) {
		if (getPropertyName(memberPath.node) !== "addEqualityTesters") {
			continue;
		}
		const objectPath = memberPath.get("object");
		if (objectPath.node?.type !== "Identifier") {
			continue;
		}
		const binding = getImportBinding(objectPath);
		if (binding?.source === "@effect/vitest") {
			fail("unsupported addEqualityTesters usage");
		}
	}

	const setupPlans = [];
	const setupObjects = new Set();
	for (const objectPath of root.find(j.ObjectExpression).paths()) {
		for (let index = 0; index < objectPath.node.properties.length; index += 1) {
			const setupPath = objectPath.get("properties", index);
			if (getPropertyName(setupPath.node) !== "setupFiles") {
				continue;
			}

			const testObjectPath = setupPath.parent;
			const testPropertyPath = testObjectPath?.parent;
			const configObjectPath = testPropertyPath?.parent;
			const definePath = configObjectPath?.parent;
			const mergePath = definePath?.parent;
			const value = setupPath.node.value;
			const supported =
				isPlainProperty(setupPath.node, "setupFiles") &&
				testObjectPath?.node.type === "ObjectExpression" &&
				isPlainProperty(testPropertyPath?.node, "test") &&
				testPropertyPath.node.value === testObjectPath.node &&
				configObjectPath?.node.type === "ObjectExpression" &&
				definePath?.node.type === "CallExpression" &&
				definePath.node.arguments.length === 1 &&
				definePath.node.arguments[0] === configObjectPath.node &&
				definePath.node.callee?.type === "Identifier" &&
				isNamedImport(definePath.get("callee"), "vitest/config", "defineConfig") &&
				mergePath?.node.type === "CallExpression" &&
				mergePath.node.arguments.length === 2 &&
				mergePath.node.arguments[1] === definePath.node &&
				mergePath.node.callee?.type === "Identifier" &&
				isNamedImport(mergePath.get("callee"), "vitest/config", "mergeConfig") &&
				value?.type === "ArrayExpression" &&
				value.elements.length === 1 &&
				isStringLiteral(value.elements[0], "./test-setup.ts");
			if (!supported || setupObjects.has(testObjectPath.node)) {
				fail("unsupported setupFiles shape");
				continue;
			}

			setupObjects.add(testObjectPath.node);
			setupPlans.push(setupPath);
		}
	}

	const acceptedTestImports = [];
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!TEST_SOURCES.has(declarationPath.node.source.value)) {
			continue;
		}
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			if (
				specifierPath.node.type !== "ImportSpecifier" ||
				getImportedName(specifierPath.node) !== "it" ||
				getImportKind(declarationPath.node, specifierPath.node) !== "value"
			) {
				continue;
			}
			const localPath = specifierPath.get("local");
			acceptedTestImports.push({
				local: localPath.node?.name,
				scope: localPath.node?.name && localPath.scope?.lookup(localPath.node.name),
			});
		}
	}

	const methodPlans = [];
	const oldMemberPaths = root
		.find(j.Node)
		.paths()
		.filter(
			(path) =>
				(path.node.type === "MemberExpression" || path.node.type === "OptionalMemberExpression") &&
				METHOD_RENAMES.has(getPropertyName(path.node)),
		);
	for (const memberPath of oldMemberPaths) {
		const objectPath = memberPath.get("object");
		if (objectPath.node?.type !== "Identifier") {
			continue;
		}

		const local = objectPath.node.name;
		const importBinding = getImportBinding(objectPath);
		const useScope = objectPath.scope?.lookup(local);
		const shadowed = acceptedTestImports.some(
			(binding) => binding.local === local && binding.scope && binding.scope !== useScope,
		);
		if (shadowed) {
			continue;
		}

		const accepted =
			importBinding?.specifier.type === "ImportSpecifier" &&
			TEST_SOURCES.has(importBinding.source) &&
			importBinding.imported === "it" &&
			importBinding.kind === "value";
		if (!accepted) {
			const testLike =
				local === "it" ||
				local === "test" ||
				acceptedTestImports.some((binding) => binding.local === local) ||
				importBinding?.imported === "it" ||
				TEST_SOURCES.has(importBinding?.source);
			if (testLike) {
				fail(`unsupported test binding for ${local}.${getPropertyName(memberPath.node)}`);
			}
			continue;
		}

		const callPath = memberPath.parent;
		if (
			memberPath.node.type !== "MemberExpression" ||
			memberPath.node.computed ||
			memberPath.node.property?.type !== "Identifier" ||
			memberPath.node.optional ||
			callPath?.node.type !== "CallExpression" ||
			callPath.node.callee !== memberPath.node ||
			callPath.node.optional
		) {
			fail(`unsupported test method usage for ${local}.${getPropertyName(memberPath.node)}`);
			continue;
		}
		methodPlans.push(memberPath);
	}

	let supportPlan;
	if (repositoryPath === SUPPORT_PATH) {
		const aliases = root
			.find(j.TSTypeAliasDeclaration)
			.paths()
			.filter((path) => path.node.id?.name === "BannedItMethod");
		const comments = collectComments(root, j);
		const oldComments = comments.filter(
			(comment) => comment.type === "CommentBlock" && comment.value === OLD_SUPPORT_COMMENT,
		);
		const staleComments = comments.filter((comment) =>
			["`it.scopedLive`", "`it.live` (no `Scope`)"].some((reference) =>
				comment.value?.includes(reference),
			),
		);
		const alias = aliases[0];
		const types = alias?.node.typeAnnotation?.types;
		const scopedTypes =
			alias?.node.typeAnnotation?.type === "TSUnionType"
				? types.filter(
						(type) => type.type === "TSLiteralType" && isStringLiteral(type.literal, "scoped"),
					)
				: [];
		if (scopedTypes.length || staleComments.length) {
			if (
				aliases.length !== 1 ||
				!types ||
				scopedTypes.length !== 1 ||
				oldComments.length !== 1 ||
				staleComments.length !== 1
			) {
				fail("unsupported BannedItMethod support shape");
			} else {
				supportPlan = { alias: alias.node, comment: oldComments[0], scoped: scopedTypes[0] };
			}
		}
	}

	if (failure) {
		api.report(`[vitest] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}

	const changed =
		equalityDeclarations.size ||
		equalityStatements.size ||
		setupPlans.length ||
		methodPlans.length ||
		supportPlan;
	if (!changed) {
		return;
	}

	for (const statementPath of equalityStatements.values()) {
		statementPath.prune();
	}
	for (const declarationPath of equalityDeclarations.values()) {
		declarationPath.node.specifiers = declarationPath.node.specifiers.filter(
			(specifier) =>
				specifier.type !== "ImportSpecifier" || getImportedName(specifier) !== "addEqualityTesters",
		);
		if (!declarationPath.node.specifiers.length) {
			declarationPath.prune();
		}
	}
	for (const setupPath of setupPlans) {
		setupPath.prune();
	}
	for (const methodPath of methodPlans) {
		methodPath.node.property.name = METHOD_RENAMES.get(methodPath.node.property.name);
	}
	if (supportPlan) {
		supportPlan.alias.typeAnnotation.types = supportPlan.alias.typeAnnotation.types.filter(
			(type) => type !== supportPlan.scoped,
		);
		supportPlan.comment.value = NEW_SUPPORT_COMMENT;
	}

	const output = root.find(j.Program).nodes()[0].body.length ? root.toSource() : "\n";
	api.report(`[vitest] transformed ${repositoryPath}`);
	return output;
}
