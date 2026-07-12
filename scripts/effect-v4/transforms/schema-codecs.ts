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

const EFFECT_SOURCES = new Set([
	"effect",
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/workflow",
]);
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

const isOwnedSchema = (path, repositoryPath) => {
	const binding = getImportBinding(path.get("object"));
	return (
		binding?.kind === "value" &&
		binding.specifier.type === "ImportSpecifier" &&
		binding.imported === "Schema" &&
		isEffectSource(binding.source, repositoryPath)
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

export default function schemaCodecs(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-codecs] warning: skipped ${file.path}: outside lexical scope`);
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
			member.object?.type !== "Identifier" ||
			!isOwnedSchema(path, repositoryPath)
		) {
			continue;
		}

		const property = getPropertyName(member);
		if (property === "decodeUnknown") {
			if (!member.computed && !member.optional) plans.push({ member, property });
			continue;
		}
		if (property === "decodeUnknownEither") {
			const call = path.parent?.node;
			if (member.computed) {
				failure ??= "unsupported computed Schema.decodeUnknownEither";
			} else if (
				member.optional ||
				call?.type === "OptionalCallExpression" ||
				(call?.type === "CallExpression" && call.optional)
			) {
				failure ??= "unsupported optional Schema.decodeUnknownEither";
			} else {
				plans.push({ member, property });
			}
			continue;
		}
		if (property !== "parseJson") continue;

		const call = path.parent?.node;
		if (member.computed) {
			failure ??= "unsupported computed Schema.parseJson";
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= "unsupported optional Schema.parseJson";
		} else if (
			call?.type !== "CallExpression" ||
			call.callee !== member ||
			call.arguments.length !== 1 ||
			call.arguments[0].type === "SpreadElement"
		) {
			failure ??= "unsupported Schema.parseJson arity";
		} else {
			plans.push({ member, property });
		}
	}

	if (failure) {
		api.report(`[schema-codecs] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	const counts = { decodeUnknown: 0, decodeUnknownEither: 0, parseJson: 0 };
	for (const plan of plans) {
		counts[plan.property] += 1;
		plan.member.property.name = {
			decodeUnknown: "decodeUnknownEffect",
			decodeUnknownEither: "decodeUnknownResult",
			parseJson: "fromJsonString",
		}[plan.property];
	}

	api.report(
		`[schema-codecs] transformed ${repositoryPath} (${plans.length} occurrences: decodeUnknown ${counts.decodeUnknown}, decodeUnknownEither ${counts.decodeUnknownEither}, parseJson ${counts.parseJson})`,
	);
	return root.toSource();
}
