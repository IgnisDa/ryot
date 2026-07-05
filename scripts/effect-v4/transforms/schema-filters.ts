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
			kind: declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value",
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

const hasTypeArguments = (call) =>
	(call.typeArguments?.params?.length ?? call.typeArguments?.length ?? 0) > 0 ||
	(call.typeParameters?.params?.length ?? call.typeParameters?.length ?? 0) > 0;

const getStaticPropertyName = (property) => {
	if (property.computed) return;
	if (property.key?.type === "Identifier") return property.key.name;
	if (property.key?.type === "StringLiteral" || property.key?.type === "Literal") {
		return property.key.value;
	}
};

const hasTypePredicate = (callback) => {
	const annotation =
		callback.returnType?.typeAnnotation ??
		callback.returnType ??
		callback.typeAnnotation?.typeAnnotation;
	return annotation?.type === "TSTypePredicate";
};

const isFunction = (node) =>
	node?.type === "ArrowFunctionExpression" ||
	node?.type === "FunctionExpression" ||
	node?.type === "FunctionDeclaration";

const isReassigned = (j, root, name, scope) => {
	for (const path of root.find(j.Identifier, { name }).paths()) {
		if (path.scope?.lookup(name) !== scope) continue;
		const parent = path.parent?.node;
		if (
			(parent?.type === "AssignmentExpression" && parent.left === path.node) ||
			(parent?.type === "UpdateExpression" && parent.argument === path.node) ||
			((parent?.type === "ForInStatement" || parent?.type === "ForOfStatement") &&
				parent.left === path.node)
		) {
			return true;
		}
	}
	return false;
};

const getFunctionFailure = (callback) => {
	if (hasTypePredicate(callback)) return "type-predicate callback";
	if (callback.params.length !== 1) return "callback parameter count";
	if (callback.params[0].type === "RestElement") return "rest-parameter callback";
};

const getCallbackPlan = (j, root, callbackPath) => {
	const callback = callbackPath.node;
	if (isFunction(callback)) {
		return { failure: getFunctionFailure(callback) };
	}
	if (callback?.type !== "Identifier") return { failure: "unresolved callback" };

	const name = callback.name;
	const scope = callbackPath.scope?.lookup(name);
	const bindings = scope?.getBindings()[name];
	if (!scope || bindings?.length !== 1) return { failure: "unresolved callback" };

	const binding = bindings[0];
	let declaration;
	for (let parent = binding.parent; parent; parent = parent.parent) {
		if (parent.node?.type === "FunctionDeclaration" || parent.node?.type === "VariableDeclarator") {
			declaration = parent;
			break;
		}
	}
	let localFunction = declaration?.node;
	if (declaration?.node?.type === "VariableDeclarator") {
		const variableDeclaration = declaration.parent?.node;
		if (
			variableDeclaration?.type !== "VariableDeclaration" ||
			variableDeclaration.kind !== "const"
		) {
			return { failure: "mutable callback" };
		}
		localFunction = declaration.node.init;
	}
	if (!isFunction(localFunction)) return { failure: "unresolved callback" };
	if (isReassigned(j, root, name, scope)) return { failure: "reassigned callback" };
	if (declaration.node.type === "VariableDeclarator" && declaration.node.id.typeAnnotation) {
		return { failure: "annotated callback" };
	}
	return { failure: getFunctionFailure(localFunction) };
};

const getAnnotationPlan = (annotation) => {
	if (!annotation) return { messages: [] };
	if (annotation.type !== "ObjectExpression") return { failure: "dynamic annotations" };

	const messages = [];
	let hasMessage = false;
	for (const property of annotation.properties) {
		const name = getStaticPropertyName(property);
		if (
			(property.type !== "ObjectProperty" && property.type !== "Property") ||
			(property.type === "Property" && property.kind !== "init") ||
			property.method ||
			property.shorthand ||
			name === undefined
		) {
			return { failure: "unsupported annotation property" };
		}
		if (name !== "message") continue;
		if (hasMessage) return { failure: "duplicate message annotation" };
		hasMessage = true;

		const value = property.value;
		if (value.type === "ArrowFunctionExpression") {
			if (value.params.length || value.body.type === "BlockStatement" || value.async) {
				return { failure: "unsupported message callback" };
			}
			messages.push({ property, value });
		} else if (
			value.type !== "StringLiteral" &&
			!(value.type === "Literal" && typeof value.value === "string") &&
			!(value.type === "TemplateLiteral" && value.expressions.length === 0)
		) {
			return { failure: "dynamic message annotation" };
		}
	}
	return { messages };
};

const getFreshIdentifier = (j, root, base, reserved = new Set()) => {
	const names = new Set(
		root
			.find(j.Identifier)
			.nodes()
			.map((identifier) => identifier.name),
	);
	let name = base;
	for (let suffix = 2; names.has(name) || reserved.has(name); suffix += 1)
		name = `${base}${suffix}`;
	reserved.add(name);
	return j.identifier(name);
};

const makeLazyMessagePredicate = (j, root, predicate, message) => {
	const reserved = new Set();
	const input = getFreshIdentifier(j, root, "schemaFilterInput", reserved);
	const output = getFreshIdentifier(j, root, "schemaFilterOutput", reserved);
	const invocation = j.callExpression(predicate, [j.identifier(input.name)]);
	const messageInvocation = j.callExpression(message.value, []);
	message.value.comments = [
		...(message.property.comments ?? []),
		...(message.value.comments ?? []),
	];

	return j.arrowFunctionExpression(
		[j.identifier(input.name)],
		j.blockStatement([
			j.variableDeclaration("const", [j.variableDeclarator(j.identifier(output.name), invocation)]),
			j.returnStatement(
				j.conditionalExpression(
					j.logicalExpression(
						"||",
						j.binaryExpression("===", j.identifier(output.name), j.booleanLiteral(true)),
						j.binaryExpression("===", j.identifier(output.name), j.identifier("undefined")),
					),
					j.identifier(output.name),
					messageInvocation,
				),
			),
		]),
	);
};

export default function schemaFilters(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-filters] warning: skipped ${file.path}: outside lexical scope`);
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
			getPropertyName(member) !== "filter" ||
			!isOwnedSchema(path, repositoryPath)
		) {
			continue;
		}

		const callPath = path.parent;
		const call = callPath?.node;
		if (member.computed) {
			failure ??= "unsupported computed Schema.filter";
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= "unsupported optional Schema.filter";
		} else if (call?.type !== "CallExpression" || call.callee !== member) {
			failure ??= "unsupported Schema.filter usage";
		} else if (hasTypeArguments(call)) {
			failure ??= "unsupported Schema.filter type arguments";
		} else if (call.arguments.some((argument) => argument.type === "SpreadElement")) {
			failure ??= "unsupported Schema.filter spread arguments";
		} else if (call.arguments.length < 1 || call.arguments.length > 2) {
			failure ??= "unsupported Schema.filter argument count";
		} else {
			const callback = getCallbackPlan(j, root, callPath.get("arguments", 0));
			const annotations = getAnnotationPlan(call.arguments[1]);
			if (callback.failure) {
				failure ??= `unsupported Schema.filter ${callback.failure}`;
			} else if (annotations.failure) {
				failure ??= `unsupported Schema.filter ${annotations.failure}`;
			} else {
				plans.push({ annotations, call, path: callPath });
			}
		}
	}

	if (failure) {
		api.report(`[schema-filters] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	let messages = 0;
	for (const plan of plans) {
		for (const message of plan.annotations.messages) {
			messages += 1;
			plan.call.arguments[0] = makeLazyMessagePredicate(j, root, plan.call.arguments[0], message);
			plan.call.arguments[1].properties = plan.call.arguments[1].properties.filter(
				(property) => property !== message.property,
			);
			if (!plan.call.arguments[1].properties.length) plan.call.arguments.pop();
		}
		plan.call.callee.property.name = "makeFilter";
		plan.path.replace(
			j.callExpression(
				j.memberExpression(j.identifier(plan.call.callee.object.name), j.identifier("check")),
				[plan.call],
			),
		);
	}

	api.report(
		`[schema-filters] transformed ${repositoryPath} (${plans.length} occurrences, ${messages} messages)`,
	);
	return root.toSource();
}
