import { relative, resolve, sep } from "node:path";

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
	"@ryot-app/plugin-backend-sdk/effect",
	"@ryot-app/plugin-client-sdk/effect",
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
	importedFrom(context, node, "effect/workflow", "Workflow") ||
	(node.type === "MemberExpression" &&
		propertyName(node) === "Workflow" &&
		importedFrom(context, node.object, "effect/workflow", "*"));

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

const manifestTable = "pluginRevisionManifest";
const manifestTableName = "plugin_revision_manifest";
const revisionNames = new Set(["pluginRevision", manifestTable]);
const typePositionTypes = new Set(["TSTypeQuery", "TSTypeReference", "TSIndexedAccessType"]);
const functionTypes = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const backendSourcePrefix = "kernel/backend/src/";
const unguardedPatterns = [
	/\.test\.ts$/,
	/\.test-support\.ts$/,
	/(^|\/)test-support\.ts$/,
	/^kernel\/backend\/src\/testing\//,
	/^kernel\/backend\/src\/drizzle\//,
];

const isFunctionValue = (node) =>
	node !== null &&
	node !== undefined &&
	(functionTypes.has(node.type) ||
		(node.type === "CallExpression" &&
			node.arguments.some((argument) => functionTypes.has(argument.type))));

const nameOf = (node) => {
	if (node.type === "Identifier") {
		return node.name;
	}
	return node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
};

const isInsideCallArguments = (ancestors, index) =>
	ancestors.some(
		(ancestor, position) =>
			position > index &&
			ancestor.type === "CallExpression" &&
			ancestor.callee !== ancestors[position - 1],
	);

const ownerOf = (ancestors) => {
	for (const [index, ancestor] of ancestors.entries()) {
		if (ancestor.type === "VariableDeclarator" && ancestor.id.type === "Identifier") {
			const { init } = ancestor;
			if (
				init &&
				(functionTypes.has(init.type) ||
					init.type === "CallExpression" ||
					init.type === "ObjectExpression")
			) {
				return ancestor.id.name;
			}
		} else if (ancestor.type === "FunctionDeclaration" && ancestor.id) {
			return ancestor.id.name;
		} else if (
			(ancestor.type === "Property" || ancestor.type === "MethodDefinition") &&
			isFunctionValue(ancestor.value) &&
			!isInsideCallArguments(ancestors, index)
		) {
			return nameOf(ancestor.key);
		}
	}
	return "<module>";
};

const isTypePosition = (ancestors) =>
	ancestors.some(
		(ancestor) =>
			typePositionTypes.has(ancestor.type) ||
			(ancestor.type === "ImportDeclaration" && ancestor.importKind === "type") ||
			(ancestor.type === "ImportSpecifier" && ancestor.importKind === "type"),
	);

const endsInRevision = (node) => {
	if (node.type === "Identifier") {
		return revisionNames.has(node.name);
	}
	return node.type === "MemberExpression" && revisionNames.has(propertyName(node) ?? "");
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
									"Register workflows with implementWorkflow from kernel/backend/src/platform/workflow/scope.ts.",
							});
						}
					},
				};
			},
		},
		"no-hot-manifest-read": {
			meta: {
				schema: [
					{
						type: "object",
						additionalProperties: false,
						properties: {
							allow: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									required: ["file", "owners"],
									properties: {
										file: { type: "string" },
										owners: {
											anyOf: [{ const: "*" }, { type: "array", items: { type: "string" } }],
										},
									},
								},
							},
						},
					},
				],
			},
			create(context) {
				const file = relative(context.cwd, resolve(context.cwd, context.filename))
					.split(sep)
					.join("/");
				if (
					!file.startsWith(backendSourcePrefix) ||
					unguardedPatterns.some((pattern) => pattern.test(file))
				) {
					return {};
				}
				const allowed = (context.options[0]?.allow ?? []).find(
					(entry) => entry.file === file,
				)?.owners;
				const check = (node, message) => {
					const owner = ownerOf(context.sourceCode.getAncestors(node).toReversed());
					if (allowed === "*" || allowed?.includes(owner)) {
						return;
					}
					context.report({ node, message: `${message} (owner: ${owner})` });
				};
				const checkText = (node, text) => {
					if (text.includes(manifestTableName)) {
						check(
							node,
							`Do not read ${manifestTableName} outside the allowlisted cold owners; use revision section columns or definition_* rows.`,
						);
					}
				};
				return {
					Identifier(node) {
						if (node.name !== manifestTable) {
							return;
						}
						const ancestors = context.sourceCode.getAncestors(node).toReversed();
						const [parent] = ancestors;
						if (
							isTypePosition(ancestors) ||
							(parent.type === "VariableDeclarator" && parent.id === node) ||
							(parent.type === "ImportSpecifier" &&
								parent.local === node &&
								parent.imported !== node &&
								parent.imported.name === node.name)
						) {
							return;
						}
						check(
							node,
							`Do not reference ${manifestTable} outside the allowlisted cold owners; use revision section columns or definition_* rows.`,
						);
					},
					Literal(node) {
						if (typeof node.value === "string") {
							checkText(node, node.value);
						}
					},
					TemplateElement(node) {
						checkText(node, node.value.cooked ?? node.value.raw);
					},
					CallExpression(node) {
						const { callee } = node;
						if (
							callee.type === "MemberExpression" &&
							propertyName(callee) === "update" &&
							node.arguments[0] &&
							endsInRevision(node.arguments[0])
						) {
							check(callee.property, "Do not update plugin revisions; they are immutable.");
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
