const promiseMethods = new Set(["then", "catch", "finally"]);

const isEffectSource = (source) =>
	source === "effect" ||
	source.startsWith("effect/") ||
	source.startsWith("@effect/") ||
	source === "@ryot-app/sandbox-sdk/effect";

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
	},
};
