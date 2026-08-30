const promiseMethods = new Set(["then", "catch", "finally"]);

const effectFacadeSources = new Set([
	"effect",
	"@ryot-app/sandbox-sdk/effect",
	"@ryot-app/client-sdk/effect",
]);

const getImportedName = (specifier) => {
	if (specifier.type !== "ImportSpecifier") {
		return undefined;
	}
	return specifier.imported.type === "Identifier"
		? specifier.imported.name
		: specifier.imported.value;
};

const trackEffectImport = (node, effectBindings, effectNamespaces) => {
	const source = node.source.value;
	for (const specifier of node.specifiers) {
		if (source === "effect/Effect" && specifier.type === "ImportNamespaceSpecifier") {
			effectBindings.add(specifier.local.name);
		} else if (effectFacadeSources.has(source)) {
			if (getImportedName(specifier) === "Effect") {
				effectBindings.add(specifier.local.name);
			} else if (specifier.type === "ImportNamespaceSpecifier") {
				effectNamespaces.add(specifier.local.name);
			}
		}
	}
};

const isEffectBinding = (node, effectBindings, effectNamespaces) => {
	if (node.type === "Identifier") {
		return effectBindings.has(node.name);
	}
	if (node.type !== "MemberExpression") {
		return false;
	}
	return (
		!node.computed &&
		node.object.type === "Identifier" &&
		effectNamespaces.has(node.object.name) &&
		node.property.name === "Effect"
	);
};

const normalizeFilename = (filename) => filename.replaceAll("\\", "/");

const isServiceOwnerFile = (filename) =>
	/(?:^|\/)(kernel\/(backend|client)|migrations\/[^/]+|plugins\/[^/]+\/host|apps\/server)\//.test(
		normalizeFilename(filename),
	);

const isAppServiceSource = (source) =>
	["#", ".", "@ryot-app/kernel-backend/"].some((prefix) => source.startsWith(prefix));

const scopedContextServices = new Set(["AuthorizationContext", "CurrentUser"]);

const isTestFile = (filename) => {
	const normalizedFilename = normalizeFilename(filename);
	return [/\.test\.tsx?$/, /[-.]test-support\.ts$/, /(?:^|\/)test-(support|utils)\//].some(
		(pattern) => pattern.test(normalizedFilename),
	);
};

export default {
	meta: { name: "ryot" },
	rules: {
		"no-promise-chains": {
			create(context) {
				const effectBindings = new Set();
				const effectNamespaces = new Set();
				return {
					ImportDeclaration(node) {
						trackEffectImport(node, effectBindings, effectNamespaces);
					},
					CallExpression(node) {
						const { callee } = node;
						if (
							callee.type !== "MemberExpression" ||
							callee.computed ||
							!promiseMethods.has(callee.property.name)
						) {
							return;
						}
						if (isEffectBinding(callee.object, effectBindings, effectNamespaces)) {
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
		"no-app-service-provide": {
			create(context) {
				if (!isServiceOwnerFile(context.filename) || isTestFile(context.filename)) {
					return {};
				}
				const effectBindings = new Set();
				const effectNamespaces = new Set();
				const appServices = new Set();
				return {
					ImportDeclaration(node) {
						trackEffectImport(node, effectBindings, effectNamespaces);
						if (!isAppServiceSource(node.source.value)) {
							return;
						}
						for (const specifier of node.specifiers) {
							if (!scopedContextServices.has(getImportedName(specifier))) {
								appServices.add(specifier.local.name);
							}
						}
					},
					CallExpression(node) {
						const { callee } = node;
						const service = node.arguments.length === 3 ? node.arguments[1] : node.arguments[0];
						if (
							callee.type !== "MemberExpression" ||
							callee.computed ||
							!isEffectBinding(callee.object, effectBindings, effectNamespaces) ||
							callee.property.name !== "provideService" ||
							service?.type !== "Identifier" ||
							!appServices.has(service.name)
						) {
							return;
						}
						context.report({
							node: service,
							message: `${service.name} is app-owned. Capture it in the owning service constructor or Layer instead of providing it at the call site.`,
						});
					},
				};
			},
		},
	},
};
