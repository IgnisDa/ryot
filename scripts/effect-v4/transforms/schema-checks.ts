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

const CHECKS = {
	positive: "isGreaterThan",
	nonNegative: "isGreaterThanOrEqualTo",
	greaterThan: "isGreaterThan",
	greaterThanOrEqualTo: "isGreaterThanOrEqualTo",
	lessThan: "isLessThan",
	lessThanOrEqualTo: "isLessThanOrEqualTo",
	between: "isBetween",
	int: "isInt",
	multipleOf: "isMultipleOf",
	finite: "isFinite",
	minItems: "isMinLength",
	maxItems: "isMaxLength",
	minLength: "isMinLength",
	maxLength: "isMaxLength",
	length: "isLengthBetween",
	pattern: "isPattern",
	nonEmptyString: "isNonEmpty",
} as const;

const ANNOTATION_INDEX = {
	positive: 0,
	nonNegative: 0,
	int: 0,
	finite: 0,
	between: 2,
	maxItems: 1,
	minItems: 1,
	greaterThan: 1,
	lessThan: 1,
	maxLength: 1,
	minLength: 1,
	multipleOf: 1,
	nonEmptyString: 0,
	greaterThanOrEqualTo: 1,
	lessThanOrEqualTo: 1,
	length: 1,
	pattern: 1,
} as const;

const ARGUMENT_RANGE = {
	positive: [0, 1],
	nonNegative: [0, 1],
	int: [0, 1],
	finite: [0, 1],
	between: [2, 3],
	maxItems: [1, 2],
	minItems: [1, 2],
	greaterThan: [1, 2],
	lessThan: [1, 2],
	maxLength: [1, 2],
	minLength: [1, 2],
	multipleOf: [1, 2],
	nonEmptyString: [0, 1],
	greaterThanOrEqualTo: [1, 2],
	lessThanOrEqualTo: [1, 2],
	length: [1, 2],
	pattern: [1, 2],
} as const;

const EFFECT_SOURCES = new Set([
	"effect",
	"@ryot/sandbox-sdk/effect",
	"@ryot/sandbox-sdk/workflow",
]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();

const SUPPORTED_SIGN_CHECKS = new Set(["positive", "nonNegative"]);
const UNSUPPORTED_SIGN_CHECKS = new Set(["negative", "nonPositive"]);

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

const getAnnotationPlan = (call, legacy) => {
	const annotation = call.arguments[ANNOTATION_INDEX[legacy]];
	if (!annotation) return { messages: [] };
	if (annotation.type !== "ObjectExpression") return { failure: "dynamic annotations" };

	const messages = [];
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

const getLengthArguments = (j, call) => {
	const value = call.arguments[0];
	const annotation = call.arguments[1];
	if (
		value.type === "NumericLiteral" ||
		(value.type === "Literal" && typeof value.value === "number")
	) {
		const maximum = j.literal(value.value);
		return [value, maximum, ...(annotation ? [annotation] : [])];
	}
	if (value.type !== "ObjectExpression" || value.properties.length !== 2) return;

	const [minimum, maximum] = value.properties;
	if (
		(minimum.type !== "ObjectProperty" && minimum.type !== "Property") ||
		(maximum.type !== "ObjectProperty" && maximum.type !== "Property") ||
		(minimum.type === "Property" && minimum.kind !== "init") ||
		(maximum.type === "Property" && maximum.kind !== "init") ||
		minimum.method ||
		maximum.method ||
		minimum.shorthand ||
		maximum.shorthand ||
		getStaticPropertyName(minimum) !== "min" ||
		getStaticPropertyName(maximum) !== "max"
	) {
		return;
	}
	return [minimum.value, maximum.value, ...(annotation ? [annotation] : [])];
};

export default function schemaChecks(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[schema-checks] warning: skipped ${file.path}: outside lexical scope`);
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

		const legacy = getPropertyName(member);
		if (UNSUPPORTED_SIGN_CHECKS.has(legacy)) {
			failure ??= `unsupported sign Schema.${legacy}; guard violation retained`;
			continue;
		}
		if (!Object.hasOwn(CHECKS, legacy)) continue;

		const call = path.parent?.node;
		if (member.computed) {
			failure ??= `unsupported computed Schema.${legacy}`;
		} else if (
			member.optional ||
			call?.type === "OptionalCallExpression" ||
			(call?.type === "CallExpression" && call.optional)
		) {
			failure ??= `unsupported optional Schema.${legacy}`;
		} else if (call?.type !== "CallExpression" || call.callee !== member) {
			failure ??= `unsupported Schema.${legacy} usage`;
		} else if (hasTypeArguments(call)) {
			failure ??= `unsupported Schema.${legacy} type arguments`;
		} else if (call.arguments.some((argument) => argument.type === "SpreadElement")) {
			failure ??= `unsupported Schema.${legacy} spread arguments`;
		} else {
			const [minimum, maximum] = ARGUMENT_RANGE[legacy];
			if (call.arguments.length < minimum || call.arguments.length > maximum) {
				failure ??= `unsupported Schema.${legacy} argument count`;
			} else {
				const annotations = getAnnotationPlan(call, legacy);
				const lengthArguments = legacy === "length" ? getLengthArguments(j, call) : undefined;
				if (annotations.failure) {
					failure ??= `unsupported Schema.${legacy} ${annotations.failure}`;
				} else if (legacy === "length" && !lengthArguments) {
					failure ??= "unsupported Schema.length value";
				} else {
					plans.push({ annotations, call, legacy, lengthArguments, path: path.parent });
				}
			}
		}
	}

	if (failure) {
		api.report(`[schema-checks] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!plans.length) return;

	const counts = Object.fromEntries(Object.keys(CHECKS).map((name) => [name, 0]));
	for (const plan of plans) {
		counts[plan.legacy] += 1;
		for (const message of plan.annotations.messages) {
			message.value.body.comments = [
				...(message.value.comments ?? []),
				...(message.value.body.comments ?? []),
			];
			message.property.value = message.value.body;
		}
		if (plan.legacy === "between") {
			const [minimum, maximum, annotation] = plan.call.arguments;
			plan.call.arguments = [
				j.objectExpression([
					j.property("init", j.identifier("minimum"), minimum),
					j.property("init", j.identifier("maximum"), maximum),
				]),
				...(annotation ? [annotation] : []),
			];
		} else if (plan.lengthArguments) {
			plan.call.arguments = plan.lengthArguments;
		} else if (SUPPORTED_SIGN_CHECKS.has(plan.legacy)) {
			plan.call.arguments = [j.literal(0), ...plan.call.arguments];
		}
		plan.call.callee.property.name = CHECKS[plan.legacy];
		plan.path.replace(
			j.callExpression(
				j.memberExpression(j.identifier(plan.call.callee.object.name), j.identifier("check")),
				[plan.call],
			),
		);
	}

	const signSummary = Object.keys(CHECKS)
		.filter((name) => SUPPORTED_SIGN_CHECKS.has(name) && counts[name] > 0)
		.map((name) => `${name} ${counts[name]}`)
		.join(", ");
	const checkSummary = Object.keys(CHECKS)
		.filter((name) => !SUPPORTED_SIGN_CHECKS.has(name) && counts[name] > 0)
		.map((name) => `${name} ${counts[name]}`)
		.join(", ");
	const summary = [
		signSummary && `supported signs ${signSummary}`,
		checkSummary && `checks ${checkSummary}`,
	]
		.filter(Boolean)
		.join("; ");
	api.report(
		`[schema-checks] transformed ${repositoryPath} (${plans.length} occurrences: ${summary})`,
	);
	return root.toSource();
}
