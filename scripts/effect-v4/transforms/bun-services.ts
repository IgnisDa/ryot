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

const SOURCE = "@effect/platform-bun";
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();

const getRepositoryPath = (path) => {
	const repositoryPath = relative(REPOSITORY_ROOT, resolve(REPOSITORY_ROOT, path))
		.split(sep)
		.join("/");
	const scopeRoot = SCOPE_ROOTS.find(
		(root) => repositoryPath === root || repositoryPath.startsWith(`${root}/`),
	);
	if (!scopeRoot || GENERATED_FILES.has(basename(repositoryPath))) return;

	const scopedParts = repositoryPath.slice(scopeRoot.length + 1).split("/");
	if (scopedParts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return;
	return repositoryPath;
};

const importedName = (specifier) =>
	specifier.imported?.type === "Identifier" ? specifier.imported.name : undefined;

const isAllowedReference = (path) => {
	const parent = path.parent?.node;
	if (
		parent?.type !== "MemberExpression" ||
		parent.object !== path.node ||
		parent.computed ||
		parent.optional ||
		parent.property?.type !== "Identifier" ||
		parent.property.name !== "layer"
	) {
		return false;
	}
	for (let ancestor = path.parent; ancestor; ancestor = ancestor.parent) {
		if (
			ancestor.node?.type === "TSTypeReference" ||
			ancestor.node?.type === "TSQualifiedName" ||
			ancestor.node?.type === "TSTypeQuery"
		) {
			return false;
		}
	}
	return true;
};

const topLevelName = (statement) => {
	const declaration =
		statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
	if (
		declaration?.type === "TSInterfaceDeclaration" ||
		declaration?.type === "TSTypeAliasDeclaration" ||
		declaration?.type === "TSEnumDeclaration" ||
		declaration?.type === "TSModuleDeclaration" ||
		declaration?.type === "TSImportEqualsDeclaration"
	) {
		return declaration.id?.name;
	}
};

const hasTypeCollision = (root) =>
	root.get().node.program.body.some((statement) => topLevelName(statement) === "BunServices");

const hasNamespaceAccess = (root, j) => {
	const locals = root
		.find(j.ImportDeclaration, { source: { value: SOURCE } })
		.find(j.ImportNamespaceSpecifier)
		.nodes()
		.map((specifier) => specifier.local?.name)
		.filter(Boolean);
	return locals.some((local) => {
		const isBunContext = (member) =>
			(!member.computed && member.property?.name === "BunContext") ||
			(member.computed && member.property?.value === "BunContext");
		return (
			root
				.find(j.MemberExpression, { object: { type: "Identifier", name: local } })
				.nodes()
				.some(isBunContext) ||
			root
				.find(j.OptionalMemberExpression, { object: { type: "Identifier", name: local } })
				.nodes()
				.some(isBunContext) ||
			root
				.find(j.TSQualifiedName, {
					left: { type: "Identifier", name: local },
					right: { type: "Identifier", name: "BunContext" },
				})
				.size() > 0
		);
	});
};

export default function bunServices(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[bun-services] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	if (hasNamespaceAccess(root, j)) {
		api.report(
			`[bun-services] warning: skipped ${repositoryPath}: unsupported BunContext reference`,
		);
		return file.source;
	}

	const plans = [];
	for (const declarationPath of root
		.find(j.ImportDeclaration, { source: { value: SOURCE } })
		.paths()) {
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (specifier.type !== "ImportSpecifier" || importedName(specifier) !== "BunContext")
				continue;

			const local = specifier.local?.name ?? "BunContext";
			const localPath = specifierPath.get("local");
			const scope = localPath.scope?.lookup(local);
			const references = [
				...root
					.find(j.Identifier, { name: local })
					.paths()
					.filter(
						(path) =>
							path.parent?.node?.type !== "ImportSpecifier" && path.scope?.lookup(local) === scope,
					),
				...root.find(j.JSXIdentifier, { name: local }).paths(),
			];
			if (
				!scope ||
				declarationPath.node.importKind === "type" ||
				specifier.importKind === "type" ||
				references.some((reference) => !isAllowedReference(reference))
			) {
				api.report(
					`[bun-services] warning: skipped ${repositoryPath}: unsupported BunContext reference`,
				);
				return file.source;
			}
			plans.push({ declarationPath, local, references, scope, specifier });
		}
	}
	if (!plans.length) return;

	const collision =
		hasTypeCollision(root) ||
		plans.some(
			({ references, scope }) =>
				scope?.lookup("BunServices") ||
				references.some((reference) => reference.scope?.lookup("BunServices")),
		);
	let referenceCount = 0;
	for (const { declarationPath, local, references, specifier } of plans) {
		if (local === "BunContext" && collision) {
			const replacement = j.importSpecifier(
				j.identifier("BunServices"),
				j.identifier("BunContext"),
			);
			replacement.comments = specifier.comments;
			replacement.importKind = specifier.importKind;
			const index = declarationPath.node.specifiers.indexOf(specifier);
			declarationPath.node.specifiers[index] = replacement;
		} else {
			specifier.imported.name = "BunServices";
			if (local === "BunContext") {
				specifier.local.name = "BunServices";
				for (const reference of references) reference.node.name = "BunServices";
				referenceCount += references.length;
			}
		}
	}

	const importLabel = plans.length === 1 ? "import binding" : "import bindings";
	const referenceLabel = referenceCount === 1 ? "reference" : "references";
	api.report(
		`[bun-services] transformed ${repositoryPath} (${plans.length} ${importLabel}, ${referenceCount} ${referenceLabel})`,
	);
	return root.toSource();
}
