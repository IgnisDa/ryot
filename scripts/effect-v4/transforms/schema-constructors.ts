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
const CONSTRUCTORS = new Set(["Literal", "Union", "Record", "Tuple"]);
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
	if (!local || isTypeParameterShadowed(identifierPath, local)) return;

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || bindings?.length !== 1) return;

		const path = bindings[0];
		const declaration = getAncestorPath(path, "ImportDeclaration")?.node;
		const specifier = path.parent?.node;
		if (!declaration || !specifier || specifier.local !== path.node) return;

		return {
			declaration,
			imported: specifier.imported?.name ?? specifier.imported?.value,
			kind: declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value",
			source: declaration.source.value,
			specifier,
		};
	} catch {
		return;
	}
};

const isSchemaSource = (source, repositoryPath) =>
	EFFECT_SOURCES.has(source) ||
	(source === "./effect" && repositoryPath.startsWith("libs/sandbox-sdk/src/"));

const getPropertyName = (member) => {
	if (!member.computed && member.property?.type === "Identifier") return member.property.name;
	if (
		member.computed &&
		(member.property?.type === "StringLiteral" || member.property?.type === "Literal")
	) {
		return member.property.value;
	}
};

const hasTypeArguments = (call) =>
	(call.typeArguments?.params?.length ?? call.typeArguments?.length ?? 0) > 0 ||
	(call.typeParameters?.params?.length ?? call.typeParameters?.length ?? 0) > 0;

const getSourceOffset = (source, position) => {
	const lines = source.split("\n");
	let offset = lines
		.slice(0, position.line - 1)
		.reduce((length, line) => length + line.length + 1, 0);
	let column = 0;
	for (const character of lines[position.line - 1]) {
		if (column >= position.column) break;
		offset += 1;
		column += character === "\t" ? 4 : 1;
	}
	return offset;
};

const makeArrayArgumentCall = (source, j, call) => {
	const callStart = getSourceOffset(source, call.loc.start);
	const callEnd = getSourceOffset(source, call.loc.end);
	const typeArguments = call.typeArguments ?? call.typeParameters;
	let openingParenthesis = getSourceOffset(source, typeArguments?.loc?.end ?? call.callee.loc.end);

	while (openingParenthesis < callEnd) {
		if (/\s/u.test(source[openingParenthesis])) {
			openingParenthesis += 1;
			continue;
		}
		if (source.startsWith("//", openingParenthesis)) {
			const newline = source.indexOf("\n", openingParenthesis + 2);
			if (newline === -1 || newline >= callEnd) return;
			openingParenthesis = newline + 1;
			continue;
		}
		if (source.startsWith("/*", openingParenthesis)) {
			const commentEnd = source.indexOf("*/", openingParenthesis + 2);
			if (commentEnd === -1 || commentEnd >= callEnd) return;
			openingParenthesis = commentEnd + 2;
			continue;
		}
		break;
	}

	const closingParenthesis = callEnd - 1;
	if (source[openingParenthesis] !== "(" || source[closingParenthesis] !== ")") return;

	const replacement = `${source.slice(callStart, openingParenthesis + 1)}[${source.slice(
		openingParenthesis + 1,
		closingParenthesis,
	)}]${source.slice(closingParenthesis, callEnd)}`;
	try {
		return j(`const call = ${replacement};`).find(j.CallExpression).nodes()[0];
	} catch {
		return;
	}
};

const makeTupleElements = (source, j, call) => makeArrayArgumentCall(source, j, call);

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) to[key] = [...from[key], ...(to[key] ?? [])];
	}
};

const getRecordEntries = (object) => {
	const entries = new Map();
	for (const property of object.properties) {
		if (
			property.type !== "ObjectProperty" ||
			property.computed ||
			property.method ||
			(property.kind !== undefined && property.kind !== "init") ||
			property.key?.type !== "Identifier" ||
			(property.key.name !== "key" && property.key.name !== "value")
		) {
			return;
		}
		if (entries.has(property.key.name)) return;
		entries.set(property.key.name, property);
	}
	if (entries.size !== 2 || !entries.has("key") || !entries.has("value")) return;
	if (object.properties[0].key.name !== "key" || object.properties[1].key.name !== "value") return;
	return entries;
};

const getOwnedConstructor = (path, repositoryPath) => {
	const callee = path.node.callee;
	if (
		callee?.type !== "MemberExpression" ||
		callee.computed ||
		callee.optional ||
		callee.object?.type !== "Identifier" ||
		callee.property?.type !== "Identifier"
	) {
		return;
	}
	if (!CONSTRUCTORS.has(callee.property.name)) return;

	const binding = getImportBinding(path.get("callee", "object"));
	if (
		binding?.kind !== "value" ||
		binding.specifier.type !== "ImportSpecifier" ||
		binding.imported !== "Schema" ||
		!isSchemaSource(binding.source, repositoryPath)
	) {
		return;
	}
	return callee.property.name;
};

export default function schemaConstructors(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-constructors] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const plans = [];
	const schemaImportLocals = new Set();
	let failure;
	for (const declaration of root.find(j.ImportDeclaration).nodes()) {
		if (!isSchemaSource(declaration.source.value, repositoryPath)) continue;
		for (const specifier of declaration.specifiers ?? []) {
			if (
				declaration.importKind !== "type" &&
				specifier.type === "ImportSpecifier" &&
				specifier.importKind !== "type" &&
				(specifier.imported?.name ?? specifier.imported?.value) === "Schema"
			) {
				schemaImportLocals.add(specifier.local.name);
			}
		}
	}
	for (const memberPath of root.find(j.Node).paths()) {
		const member = memberPath.node;
		if (
			(member.type !== "MemberExpression" && member.type !== "OptionalMemberExpression") ||
			getPropertyName(member) !== "Tuple" ||
			member.object?.type !== "Identifier"
		) {
			continue;
		}
		if (
			schemaImportLocals.has(member.object.name) &&
			isTypeParameterShadowed(memberPath.get("object"), member.object.name)
		) {
			failure ??= "unsupported ambiguous Schema.Tuple alias";
			continue;
		}

		const binding = getImportBinding(memberPath.get("object"));
		if (
			binding?.kind !== "value" ||
			binding.specifier.type !== "ImportSpecifier" ||
			binding.imported !== "Schema" ||
			!isSchemaSource(binding.source, repositoryPath)
		) {
			continue;
		}

		const callPath = memberPath.parent;
		const call = callPath?.node;
		if (member.computed) {
			failure ??= "unsupported computed Schema.Tuple";
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= "unsupported optional Schema.Tuple";
		} else if (call?.type !== "CallExpression" || call.callee !== member) {
			continue;
		} else if (hasTypeArguments(call)) {
			failure ??= "unsupported Schema.Tuple type arguments";
		} else if (call.arguments.some((argument) => argument.type === "SpreadElement")) {
			failure ??= "unsupported Schema.Tuple spread arguments";
		} else if (call.arguments.length !== 1 || call.arguments[0].type !== "ArrayExpression") {
			const replacement = makeTupleElements(file.source, j, call);
			if (replacement) plans.push({ constructor: "Tuple", path: callPath, replacement });
			else failure ??= "unsupported Schema.Tuple source layout";
		}
	}

	for (const path of root.find(j.CallExpression).paths()) {
		const constructor = getOwnedConstructor(path, repositoryPath);
		if (!constructor) continue;
		if (constructor === "Tuple") continue;

		const args = path.node.arguments;
		if (constructor === "Literal") {
			if (args.length >= 2 || (args.length === 1 && args[0].type === "SpreadElement")) {
				const replacement = makeArrayArgumentCall(file.source, j, path.node);
				if (replacement) {
					replacement.callee.property.name = "Literals";
					plans.push({ constructor, path, replacement });
				} else failure ??= "unsupported Schema.Literal source layout";
			}
			continue;
		}
		if (constructor === "Union") {
			if (!args.length || args[0].type !== "ArrayExpression") {
				const replacement = makeArrayArgumentCall(file.source, j, path.node);
				if (replacement) plans.push({ constructor, path, replacement });
				else failure ??= "unsupported Schema.Union source layout";
			}
			continue;
		}

		if (args.length !== 1 || args[0].type !== "ObjectExpression") continue;
		const entries = getRecordEntries(args[0]);
		if (!entries) {
			failure ??= "unsupported Schema.Record object properties";
			continue;
		}
		plans.push({ constructor, entries, object: args[0], path });
	}

	if (failure) {
		api.report(`[schema-constructors] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	const counts = { Literal: 0, Union: 0, Record: 0, Tuple: 0 };
	for (const plan of plans) {
		counts[plan.constructor] += 1;
		if (plan.constructor === "Literal") {
			plan.path.replace(plan.replacement);
		} else if (plan.constructor === "Union") {
			plan.path.replace(plan.replacement);
		} else if (plan.constructor === "Tuple") {
			plan.path.replace(plan.replacement);
		} else {
			const key = plan.entries.get("key");
			const value = plan.entries.get("value");
			copyComments(plan.object, key.value);
			copyComments(key, key.value);
			copyComments(value, value.value);
			plan.path.node.arguments = [key.value, value.value];
		}
	}

	api.report(
		`[schema-constructors] transformed ${repositoryPath} (${plans.length} occurrences: Literal ${counts.Literal}, Union ${counts.Union}, Record ${counts.Record}, Tuple ${counts.Tuple})`,
	);
	return root.toSource();
}
