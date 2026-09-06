const promiseMethods = new Set(["then", "catch", "finally"]);
const promiseFactories = new Set([
	"resolve",
	"reject",
	"all",
	"allSettled",
	"race",
	"any",
	"withResolvers",
]);

const effectFacadeSources = new Set([
	"effect",
	"@ryot-app/sandbox-sdk/effect",
	"@ryot-app/client-sdk/effect",
]);

const propertyName = (node) => {
	if (node.type !== "MemberExpression") {
		return undefined;
	}
	if (!node.computed) {
		return node.property.name;
	}
	return node.property.type === "Literal" && typeof node.property.value === "string"
		? node.property.value
		: undefined;
};

const getImportedName = (specifier) => {
	if (specifier.type !== "ImportSpecifier") {
		return undefined;
	}
	return specifier.imported.type === "Identifier"
		? specifier.imported.name
		: specifier.imported.value;
};

const variableFor = (context, node) => {
	if (node.type !== "Identifier") {
		return undefined;
	}
	let scope = context.sourceCode.getScope(node);
	while (scope) {
		const variable = scope.set.get(node.name);
		if (variable) {
			return variable;
		}
		scope = scope.upper;
	}
	return undefined;
};

const importedFrom = (context, node, source, name) => {
	const variable = variableFor(context, node);
	const definition = variable?.defs[0];
	return (
		definition?.type === "ImportBinding" &&
		definition.parent?.source.value === source &&
		(name === "*"
			? definition.node.type === "ImportNamespaceSpecifier"
			: getImportedName(definition.node) === name)
	);
};

const isEffectBinding = (context, node) => {
	if (node.type === "Identifier") {
		return (
			importedFrom(context, node, "effect/Effect", "*") ||
			[...effectFacadeSources].some((source) => importedFrom(context, node, source, "Effect"))
		);
	}
	return (
		node.type === "MemberExpression" &&
		propertyName(node) === "Effect" &&
		[...effectFacadeSources].some((source) => importedFrom(context, node.object, source, "*"))
	);
};

const initializerOf = (context, node) => {
	const variable = variableFor(context, node);
	if (
		!variable ||
		variable.references.some((reference) => reference.isWrite() && !reference.init)
	) {
		return undefined;
	}
	const definition = variable.defs[0];
	return definition?.type === "Variable" ? definition.node.init : undefined;
};

const isPromise = (context, node, seen = new Set()) => {
	if (node.type === "Identifier") {
		const variable = variableFor(context, node);
		if (!variable || seen.has(variable)) {
			return false;
		}
		seen.add(variable);
		const initializer = initializerOf(context, node);
		return initializer ? isPromise(context, initializer, seen) : false;
	}
	if (node.type === "NewExpression") {
		return (
			node.callee.type === "Identifier" &&
			node.callee.name === "Promise" &&
			!variableFor(context, node.callee)
		);
	}
	if (node.type !== "CallExpression") {
		return false;
	}
	if (node.callee.type === "Identifier") {
		const variable = variableFor(context, node.callee);
		const definition = variable?.defs[0];
		return (
			(node.callee.name === "fetch" && !variable) ||
			(definition?.type === "FunctionName" && definition.node.async === true) ||
			initializerOf(context, node.callee)?.async === true
		);
	}
	const callee = node.callee;
	return (
		callee.type === "MemberExpression" &&
		((promiseFactories.has(propertyName(callee)) &&
			callee.object.type === "Identifier" &&
			callee.object.name === "Promise" &&
			!variableFor(context, callee.object)) ||
			(promiseMethods.has(propertyName(callee)) && isPromise(context, callee.object, seen)))
	);
};

const isWorkflowFactory = (context, node) =>
	importedFrom(context, node, "effect/unstable/workflow", "Workflow") ||
	(node.type === "MemberExpression" &&
		propertyName(node) === "Workflow" &&
		importedFrom(context, node.object, "effect/unstable/workflow", "*"));

const isWorkflow = (context, node, seen = new Set()) => {
	if (node.type === "Identifier") {
		const variable = variableFor(context, node);
		if (!variable || seen.has(variable)) {
			return false;
		}
		seen.add(variable);
		const initializer = initializerOf(context, node);
		return initializer ? isWorkflow(context, initializer, seen) : false;
	}
	return (
		node.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		propertyName(node.callee) === "make" &&
		isWorkflowFactory(context, node.callee.object)
	);
};

export default {
	meta: { name: "ryot" },
	rules: {
		"no-workflow-to-layer": {
			create(context) {
				return {
					CallExpression(node) {
						const { callee } = node;
						if (
							callee.type === "MemberExpression" &&
							propertyName(callee) === "toLayer" &&
							isWorkflow(context, callee.object)
						) {
							context.report({
								node: callee.property,
								message:
									"Register workflows with implementWorkflow from kernel/backend/src/lib/infrastructure/workflow-scope.ts.",
							});
						}
					},
				};
			},
		},
		"no-promise-chains": {
			create(context) {
				return {
					CallExpression(node) {
						const { callee } = node;
						if (
							callee.type !== "MemberExpression" ||
							!promiseMethods.has(propertyName(callee)) ||
							isEffectBinding(context, callee.object) ||
							!isPromise(context, callee.object)
						) {
							return;
						}
						context.report({
							node: callee.property,
							message:
								"Use Effect for application-owned async work, or async/await at a Promise-native boundary; do not chain .then/.catch/.finally.",
						});
					},
				};
			},
		},
	},
};
