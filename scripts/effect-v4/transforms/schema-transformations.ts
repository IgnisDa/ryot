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

const SCHEMA_SOURCES = new Set([
	"effect",
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/workflow",
]);
const TRANSFORMATION_SOURCES = new Set(["effect", "@ryot/sandbox-sdk/effect"]);
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

const getImportedName = (specifier) => specifier.imported?.name ?? specifier.imported?.value;

const getImportBinding = (identifierPath) => {
	const local = identifierPath.node?.name;
	if (!local || isTypeParameterShadowed(identifierPath, local)) return;

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || bindings?.length !== 1) return;

		const path = bindings[0];
		const declarationPath = getAncestorPath(path, "ImportDeclaration");
		const specifier = path.parent?.node;
		if (!declarationPath || !specifier || specifier.local !== path.node) return;

		return {
			declarationPath,
			imported: getImportedName(specifier),
			kind:
				declarationPath.node.importKind === "type" || specifier.importKind === "type"
					? "type"
					: "value",
			local,
			scope,
			source: declarationPath.node.source.value,
			specifier,
		};
	} catch {
		return;
	}
};

const isLocalEffectSource = (source, repositoryPath) =>
	source === "./effect" && repositoryPath.startsWith("libs/sandbox-sdk/src/");

const isSchemaSource = (source, repositoryPath) =>
	SCHEMA_SOURCES.has(source) || isLocalEffectSource(source, repositoryPath);

const isTransformationSource = (source, repositoryPath) =>
	TRANSFORMATION_SOURCES.has(source) || isLocalEffectSource(source, repositoryPath);

const getOwnedSchema = (path, repositoryPath) => {
	const objectPath = path.get("object");
	if (objectPath.node?.type !== "Identifier") return;
	const binding = getImportBinding(objectPath);
	if (
		binding?.kind !== "value" ||
		binding.specifier.type !== "ImportSpecifier" ||
		binding.imported !== "Schema" ||
		!isSchemaSource(binding.source, repositoryPath)
	) {
		return;
	}
	return binding;
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

const hasTypeArguments = (call) =>
	(call.typeArguments?.params?.length ?? call.typeArguments?.length ?? 0) > 0 ||
	(call.typeParameters?.params?.length ?? call.typeParameters?.length ?? 0) > 0;

const isOptionalCall = (member, call) =>
	member.optional ||
	call?.type === "OptionalCallExpression" ||
	(call?.type === "CallExpression" && call.optional);

const getInitPropertyName = (property) => {
	if (
		property.type !== "ObjectProperty" ||
		property.computed ||
		property.method ||
		(property.kind !== undefined && property.kind !== "init")
	) {
		return;
	}
	if (property.key?.type === "Identifier") return property.key.name;
	if (property.key?.type === "StringLiteral" || property.key?.type === "Literal") {
		return property.key.value;
	}
};

const isSupportedCallback = (node) =>
	(node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
	!node.async &&
	!node.generator &&
	!node.typeParameters?.params?.length &&
	node.params.length <= 1 &&
	node.params.every((parameter) => parameter.type !== "RestElement");

const getTransformOptions = (object) => {
	if (object.properties.length !== 3) return;
	const properties = new Map();
	for (const property of object.properties) {
		const name = getInitPropertyName(property);
		if (!name || properties.has(name)) return;
		properties.set(name, property);
	}
	if (
		properties.size !== 3 ||
		!properties.has("strict") ||
		!properties.has("decode") ||
		!properties.has("encode")
	) {
		return;
	}
	const strict = properties.get("strict");
	const decode = properties.get("decode");
	const encode = properties.get("encode");
	if (strict.value.type !== "BooleanLiteral" || strict.value.value !== true) return;
	if (!isSupportedCallback(decode.value) || !isSupportedCallback(encode.value)) return;
	return { decode, encode, strict };
};

const isBindingVisible = (binding, sites) =>
	sites.every(
		(site) =>
			!isTypeParameterShadowed(site, binding.local) &&
			site.scope?.lookup(binding.local) === binding.scope,
	);

const getTransformationReference = (root, j, plans, repositoryPath) => {
	const sites = plans.filter((plan) => plan.kind === "transform").map((plan) => plan.path);
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!isTransformationSource(declarationPath.node.source.value, repositoryPath)) continue;
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (specifier.type === "ImportSpecifier" && getImportedName(specifier) === "SchemaTransformation") {
				const binding = getImportBinding(specifierPath.get("local"));
				if (binding?.kind === "value" && isBindingVisible(binding, sites)) {
					return { expression: () => j.identifier(binding.local) };
				}
			} else if (specifier.type === "ImportNamespaceSpecifier") {
				const binding = getImportBinding(specifierPath.get("local"));
				if (binding?.kind === "value" && isBindingVisible(binding, sites)) {
					return {
						expression: () =>
							j.memberExpression(j.identifier(binding.local), j.identifier("SchemaTransformation")),
					};
				}
			}
		}
	}
};

const canAddImport = (path, repositoryPath) =>
	isTransformationSource(path.node.source.value, repositoryPath) &&
	path.node.importKind !== "type" &&
	!path.node.assertions?.length &&
	!path.node.attributes?.length &&
	path.node.specifiers?.every((specifier) => specifier.type === "ImportSpecifier");

const getFreshImportLocal = (root, j, sites) => {
	const names = ["SchemaTransformation", "SchemaTransformationRuntime"];
	let suffix = 2;
	while (true) {
		const local = names.shift() ?? `SchemaTransformation${suffix++}`;
		if (
			root.find(j.Identifier, { name: local }).size() === 0 &&
			sites.every((site) => !site.scope?.lookup(local) && !isTypeParameterShadowed(site, local))
		) {
			return local;
		}
	}
};

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) to[key] = [...(to[key] ?? []), ...from[key]];
	}
};

export default function schemaTransformations(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-transformations] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const plans = [];
	let failure;

	for (const memberPath of root.find(j.Node).paths()) {
		const member = memberPath.node;
		if (
			(member.type !== "MemberExpression" && member.type !== "OptionalMemberExpression") ||
			(getPropertyName(member) !== "transform" && getPropertyName(member) !== "compose")
		) {
			continue;
		}
		const schema = getOwnedSchema(memberPath, repositoryPath);
		if (!schema) continue;
		const property = getPropertyName(member);
		const callPath = memberPath.parent;
		const call = callPath?.node;

		if (member.computed) {
			failure ??= `unsupported computed Schema.${property}`;
		} else if (isOptionalCall(member, call)) {
			failure ??= `unsupported optional Schema.${property}`;
		} else if (call?.type !== "CallExpression" || call.callee !== member) {
			failure ??= `unsupported Schema.${property} usage`;
		} else if (hasTypeArguments(call)) {
			failure ??= `unsupported Schema.${property} type arguments`;
		} else if (call.arguments.some((argument) => argument.type === "SpreadElement")) {
			failure ??= `unsupported Schema.${property} arguments`;
		} else if (property === "transform") {
			if (call.arguments.length !== 3 || call.arguments[2].type !== "ObjectExpression") {
				failure ??= "unsupported Schema.transform arguments";
			} else {
				const options = getTransformOptions(call.arguments[2]);
				if (!options) {
					failure ??= "unsupported Schema.transform options or callbacks";
				} else {
					plans.push({
						call,
						from: call.arguments[0],
						kind: "transform",
						options,
						optionsNode: call.arguments[2],
						path: callPath,
						schema,
						to: call.arguments[1],
					});
				}
			}
		} else if (call.arguments.length === 2) {
			plans.push({
				call,
				from: call.arguments[0],
				kind: "compose",
				path: callPath,
				schema,
				to: call.arguments[1],
			});
		} else if (call.arguments.length === 1) {
			const pipeCall = callPath.parent?.node;
			const pipeMember = pipeCall?.callee;
			if (
				pipeCall?.type !== "CallExpression" ||
				pipeCall.arguments.length !== 1 ||
				pipeCall.arguments[0] !== call ||
				pipeMember?.type !== "MemberExpression" ||
				pipeMember.computed ||
				pipeMember.optional ||
				pipeMember.property?.type !== "Identifier" ||
				pipeMember.property.name !== "pipe" ||
				hasTypeArguments(pipeCall)
			) {
				failure ??= "unsupported pipeable Schema.compose usage";
			} else {
				plans.push({ call, kind: "pipeable-compose", path: callPath, schema, to: call.arguments[0] });
			}
		} else {
			failure ??= "unsupported Schema.compose arguments";
		}
	}

	if (failure) {
		api.report(`[schema-transformations] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	const transformPlans = plans.filter((plan) => plan.kind === "transform");
	let transformation = getTransformationReference(root, j, plans, repositoryPath);
	if (transformPlans.length && !transformation) {
		const sites = transformPlans.map((plan) => plan.path);
		const preferred = transformPlans.map((plan) => plan.schema.declarationPath);
		const declarations = root.find(j.ImportDeclaration).paths();
		const targetPath = [...preferred, ...declarations].find(
			(path, index, paths) =>
				paths.findIndex((candidate) => candidate.node === path.node) === index &&
				canAddImport(path, repositoryPath),
		);
		const local = getFreshImportLocal(root, j, sites);
		const specifier = j.importSpecifier(
			j.identifier("SchemaTransformation"),
			local === "SchemaTransformation" ? null : j.identifier(local),
		);
		transformation = { expression: () => j.identifier(local) };

		if (targetPath) {
			targetPath.node.specifiers.push(specifier);
		} else {
			const schemaSource = transformPlans[0].schema.source;
			const source = isTransformationSource(schemaSource, repositoryPath)
				? schemaSource
				: "@ryot/sandbox-sdk/effect";
			transformPlans[0].schema.declarationPath.insertAfter(
				j.importDeclaration([specifier], j.stringLiteral(source)),
			);
		}
	}

	const counts = { compose: 0, transform: 0 };
	for (const plan of plans) {
		let decodeToArguments = [plan.to];
		if (plan.kind === "transform") {
			counts.transform += 1;
			const properties = [plan.options.decode, plan.options.encode];
			copyComments(plan.options.strict, properties[0]);
			const options = j.objectExpression(properties);
			copyComments(plan.optionsNode, options);
			const transform = j.callExpression(
				j.memberExpression(transformation.expression(), j.identifier("transform")),
				[options],
			);
			decodeToArguments = [plan.to, transform];
		} else {
			counts.compose += 1;
		}
		const decodeTo = j.callExpression(
			j.memberExpression(j.identifier(plan.schema.local), j.identifier("decodeTo")),
			decodeToArguments,
		);
		const replacement =
			plan.kind === "pipeable-compose"
				? decodeTo
				: j.callExpression(j.memberExpression(plan.from, j.identifier("pipe")), [decodeTo]);
		copyComments(plan.call, replacement);
		plan.path.replace(replacement);
	}

	api.report(
		`[schema-transformations] transformed ${repositoryPath} (${plans.length} occurrences: transform ${counts.transform}, compose ${counts.compose})`,
	);
	return root.toSource();
}
