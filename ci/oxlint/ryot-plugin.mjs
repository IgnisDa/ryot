const promiseMethods = new Set(["then", "catch", "finally"]);

const isEffectSource = (source) =>
	source === "effect" ||
	source.startsWith("effect/") ||
	source.startsWith("@effect/") ||
	source === "@ryot-app/sandbox-sdk/effect";

const isServiceOwnerFile = (filename) =>
	/\/(kernel\/(backend|client)|migrations\/[^/]+|plugins\/[^/]+\/host|apps\/server)\//.test(
		filename,
	);

const isAppServiceSource = (source) =>
	source.startsWith("#") || source.startsWith(".") || source.startsWith("@ryot-app/kernel-backend/");

const scopedContextServices = new Set(["AuthorizationContext", "CurrentUser"]);

const isTestFile = (filename) =>
	/\.test\.tsx?$/.test(filename) ||
	/[-.]test-support\.ts$/.test(filename) ||
	/\/(test-support|test-utils)\//.test(filename);

export default {
	meta: { name: "ryot" },
	rules: {
		"prefer-await-to-then": {
			create(context) {
				const effectBindings = new Set();
				return {
					ImportDeclaration(node) {
						if (!isEffectSource(node.source.value)) {
							return;
						}
						for (const specifier of node.specifiers) {
							effectBindings.add(specifier.local.name);
						}
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
						if (callee.object.type === "Identifier" && effectBindings.has(callee.object.name)) {
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
		"no-caller-provided-service": {
			create(context) {
				if (!isServiceOwnerFile(context.filename) || isTestFile(context.filename)) {
					return {};
				}
				const effectBindings = new Set();
				const appServices = new Set();
				return {
					ImportDeclaration(node) {
						const source = node.source.value;
						for (const specifier of node.specifiers) {
							if (source === "effect" && specifier.type === "ImportSpecifier") {
								if (specifier.imported.name === "Effect") {
									effectBindings.add(specifier.local.name);
								}
							} else if (
								isAppServiceSource(source) &&
								!scopedContextServices.has(specifier.local.name)
							) {
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
							callee.object.type !== "Identifier" ||
							!effectBindings.has(callee.object.name) ||
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
