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
const EFFECT_SOURCES = new Set(["effect", "@ryot/sandbox-sdk/effect"]);
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

const isEffectSource = (source, repositoryPath) =>
	EFFECT_SOURCES.has(source) || isLocalEffectSource(source, repositoryPath);

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

const getDefaultProperty = (object) => {
	if (object.properties.length !== 1) return;
	const property = object.properties[0];
	if (
		property.type !== "ObjectProperty" ||
		property.computed ||
		property.method ||
		(property.kind !== undefined && property.kind !== "init")
	) {
		return;
	}
	const name =
		property.key?.type === "Identifier"
			? property.key.name
			: property.key?.type === "StringLiteral" || property.key?.type === "Literal"
				? property.key.value
				: undefined;
	return name === "default" ? property : undefined;
};

const isThunk = (node) =>
	(node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
	!node.async &&
	!node.generator &&
	node.params.length === 0;

const hasTypeArguments = (call) =>
	(call.typeArguments?.params?.length ?? call.typeArguments?.length ?? 0) > 0 ||
	(call.typeParameters?.params?.length ?? call.typeParameters?.length ?? 0) > 0;

const isBindingVisible = (binding, sites) =>
	sites.every(
		(site) =>
			!isTypeParameterShadowed(site, binding.local) &&
			site.scope?.lookup(binding.local) === binding.scope,
	);

const getEffectModuleReference = (root, j, plans, repositoryPath, imported) => {
	const sites = plans.map((plan) => plan.path);
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!isEffectSource(declarationPath.node.source.value, repositoryPath)) continue;
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (specifier.type === "ImportSpecifier" && getImportedName(specifier) === imported) {
				const binding = getImportBinding(specifierPath.get("local"));
				if (binding?.kind === "value" && isBindingVisible(binding, sites)) {
					return { expression: () => j.identifier(binding.local) };
				}
			} else if (specifier.type === "ImportNamespaceSpecifier") {
				const binding = getImportBinding(specifierPath.get("local"));
				if (binding?.kind === "value" && isBindingVisible(binding, sites)) {
					return {
						expression: () =>
							j.memberExpression(j.identifier(binding.local), j.identifier(imported)),
					};
				}
			}
		}
	}
};

const canAddImport = (path, repositoryPath) =>
	isEffectSource(path.node.source.value, repositoryPath) &&
	path.node.importKind !== "type" &&
	!path.node.assertions?.length &&
	!path.node.attributes?.length &&
	path.node.specifiers?.every((specifier) => specifier.type === "ImportSpecifier");

const getFreshImportLocal = (root, j, sites, imported) => {
	const names = [imported, `${imported}Runtime`];
	let suffix = 2;
	while (true) {
		const local = names.shift() ?? `Effect${suffix++}`;
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

export default function schemaOptionals(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-optionals] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const plans = [];
	const optionalElementPlans = [];
	let failure;

	for (const memberPath of root.find(j.Node).paths()) {
		const member = memberPath.node;
		const property = getPropertyName(member);
		if (
			(member.type !== "MemberExpression" && member.type !== "OptionalMemberExpression") ||
			(property !== "optionalElement" && property !== "optionalWith")
		) {
			continue;
		}
		const schema = getOwnedSchema(memberPath, repositoryPath);
		if (!schema) continue;

		const callPath = memberPath.parent;
		const call = callPath?.node;
		if (property === "optionalElement") {
			if (member.computed) {
				failure ??= "unsupported computed Schema.optionalElement";
			} else if (
				member.optional ||
				call?.type === "OptionalCallExpression" ||
				(call?.type === "CallExpression" && call.optional)
			) {
				failure ??= "unsupported optional Schema.optionalElement";
			} else if (call?.type !== "CallExpression" || call.callee !== member) {
				failure ??= "unsupported Schema.optionalElement usage";
			} else if (hasTypeArguments(call)) {
				failure ??= "unsupported Schema.optionalElement type arguments";
			} else if (call.arguments.length !== 1 || call.arguments[0].type === "SpreadElement") {
				failure ??= "unsupported Schema.optionalElement arguments";
			} else {
				const tupleElementsPath = callPath.parent;
				const tupleElements = tupleElementsPath?.node;
				const tupleCallPath = tupleElementsPath?.parent;
				const tupleCall = tupleCallPath?.node;
				const tupleMemberPath = tupleCallPath?.get?.("callee");
				const tupleMember = tupleMemberPath?.node;
				if (
					tupleCall?.type !== "CallExpression" ||
					hasTypeArguments(tupleCall) ||
					tupleMember?.type !== "MemberExpression" ||
					tupleMember.computed ||
					tupleMember.optional ||
					getPropertyName(tupleMember) !== "Tuple" ||
					!getOwnedSchema(tupleMemberPath, repositoryPath)
				) {
					const variadicTuplePath = callPath.parent;
					const variadicTuple = variadicTuplePath?.node;
					const variadicMemberPath = variadicTuplePath?.get?.("callee");
					const variadicMember = variadicMemberPath?.node;
					if (
						variadicTuple?.type === "CallExpression" &&
						variadicTuple.arguments.includes(call) &&
						variadicMember?.type === "MemberExpression" &&
						!variadicMember.computed &&
						!variadicMember.optional &&
						getPropertyName(variadicMember) === "Tuple" &&
						getOwnedSchema(variadicMemberPath, repositoryPath)
					) {
						failure ??= "unsupported Schema.optionalElement variadic Schema.Tuple parent";
					} else {
						failure ??= "unsupported Schema.optionalElement usage";
					}
				} else if (
					tupleElements?.type !== "ArrayExpression" ||
					!tupleElements.elements.includes(call) ||
					tupleCall.arguments.length !== 1 ||
					tupleCall.arguments[0] !== tupleElements
				) {
					failure ??= "unsupported Schema.optionalElement usage";
				} else {
					optionalElementPlans.push({ member });
				}
			}
			continue;
		}

		if (member.computed) {
			failure ??= "unsupported computed Schema.optionalWith";
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= "unsupported optional Schema.optionalWith";
		} else if (call?.type !== "CallExpression" || call.callee !== member) {
			failure ??= "unsupported Schema.optionalWith usage";
		} else if (hasTypeArguments(call)) {
			failure ??= "unsupported Schema.optionalWith type arguments";
		} else if (
			call.arguments.length !== 2 ||
			call.arguments.some((argument) => argument.type === "SpreadElement")
		) {
			failure ??= "unsupported Schema.optionalWith arguments";
		} else if (call.arguments[1].type !== "ObjectExpression") {
			failure ??= "unsupported Schema.optionalWith options";
		} else {
			const property = getDefaultProperty(call.arguments[1]);
			if (!property) {
				failure ??= "unsupported Schema.optionalWith options";
			} else if (!isThunk(property.value)) {
				failure ??= "unsupported Schema.optionalWith default";
			} else {
				plans.push({
					call,
					options: call.arguments[1],
					path: callPath,
					property,
					schema,
					schemaValue: call.arguments[0],
					thunk: property.value,
				});
			}
		}
	}

	if (failure) {
		api.report(`[schema-optionals] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length && !optionalElementPlans.length) return;

	let references;
	if (plans.length) {
		references = {
			Effect: getEffectModuleReference(root, j, plans, repositoryPath, "Effect"),
			SchemaGetter: getEffectModuleReference(root, j, plans, repositoryPath, "SchemaGetter"),
		};
		const missing = Object.entries(references).filter(([, reference]) => !reference);
		if (missing.length) {
			const sites = plans.map((plan) => plan.path);
			const preferred = plans.map((plan) => plan.schema.declarationPath);
			const declarations = root.find(j.ImportDeclaration).paths();
			const targetPath = [...preferred, ...declarations].find(
				(path, index, paths) =>
					paths.findIndex((candidate) => candidate.node === path.node) === index &&
					canAddImport(path, repositoryPath),
			);
			const specifiers = missing.map(([imported]) => {
				const local = getFreshImportLocal(root, j, sites, imported);
				references[imported] = { expression: () => j.identifier(local) };
				return j.importSpecifier(
					j.identifier(imported),
					local === imported ? null : j.identifier(local),
				);
			});

			if (targetPath) {
				targetPath.node.specifiers.push(...specifiers);
			} else {
				const schemaSource = plans[0].schema.source;
				const source = isEffectSource(schemaSource, repositoryPath)
					? schemaSource
					: "@ryot/sandbox-sdk/effect";
				plans[0].schema.declarationPath.insertAfter(
					j.importDeclaration(specifiers, j.stringLiteral(source)),
				);
			}
		}
	}

	for (const plan of plans) {
		const schemaParameter = j.identifier("schema");
		const decodingDefault = j.callExpression(
			j.memberExpression(references.Effect.expression(), j.identifier("sync")),
			[{ ...plan.thunk }],
		);
		copyComments(plan.options, decodingDefault);
		copyComments(plan.property, decodingDefault);
		const optional = j.callExpression(
			j.memberExpression(j.identifier(plan.schema.local), j.identifier("optional")),
			[schemaParameter],
		);
		const toType = j.callExpression(
			j.memberExpression(j.identifier(plan.schema.local), j.identifier("toType")),
			[schemaParameter],
		);
		const decodeTo = j.callExpression(
			j.memberExpression(j.identifier(plan.schema.local), j.identifier("decodeTo")),
			[
				toType,
				j.objectExpression([
					j.objectProperty(
						j.identifier("decode"),
						j.callExpression(
							j.memberExpression(references.SchemaGetter.expression(), j.identifier("withDefault")),
							[decodingDefault],
						),
					),
					j.objectProperty(
						j.identifier("encode"),
						j.callExpression(
							j.memberExpression(references.SchemaGetter.expression(), j.identifier("required")),
							[],
						),
					),
				]),
			],
		);
		const decode = j.arrowFunctionExpression(
			[schemaParameter],
			j.callExpression(j.memberExpression(optional, j.identifier("pipe")), [decodeTo]),
		);
		const constructorDefault = j.callExpression(
			j.memberExpression(j.identifier(plan.schema.local), j.identifier("withConstructorDefault")),
			[
				j.callExpression(j.memberExpression(references.Effect.expression(), j.identifier("sync")), [
					plan.thunk,
				]),
			],
		);
		const replacement = j.callExpression(
			j.memberExpression(plan.schemaValue, j.identifier("pipe")),
			[decode, constructorDefault],
		);
		copyComments(plan.call, replacement);
		plan.path.replace(replacement);
	}
	for (const plan of optionalElementPlans) plan.member.property.name = "optionalKey";

	const occurrences = plans.length + optionalElementPlans.length;
	api.report(
		`[schema-optionals] transformed ${repositoryPath} (${occurrences} occurrence${occurrences === 1 ? "" : "s"})`,
	);
	return root.toSource();
}
