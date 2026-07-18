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

const EFFECT_SOURCES = new Set(["effect", "@ryot/sandbox-sdk/effect"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const EFFECT_MEMBERS = new Set([
	"Semaphore",
	"dieMessage",
	"ignoreLogged",
	"makeSemaphore",
	"mapInputContext",
	"optionFromOptional",
	"orElse",
	"timeoutFail",
	"unsandbox",
]);
const REPOSITORY_ROOT = process.cwd();

const getRepositoryPath = (path) => {
	const absolutePath = resolve(REPOSITORY_ROOT, path);
	const repositoryPath = relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
	const scopeRoot = SCOPE_ROOTS.find(
		(root) => repositoryPath === root || repositoryPath.startsWith(`${root}/`),
	);
	if (!scopeRoot || GENERATED_FILES.has(basename(repositoryPath))) {
		return;
	}

	const scopedParts = repositoryPath.slice(scopeRoot.length + 1).split("/");
	if (scopedParts.some((part) => EXCLUDED_DIRECTORIES.has(part))) {
		return;
	}
	return repositoryPath;
};

const getImportKind = (declaration, specifier) =>
	declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value";

const getImportedName = (specifier) =>
	specifier.imported?.type === "Identifier" ? specifier.imported.name : undefined;

const getAncestorPath = (path, type) => {
	for (let parent = path; parent; parent = parent.parent) {
		if (parent.node?.type === type) {
			return parent;
		}
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
	if (!local || isTypeParameterShadowed(identifierPath, local)) {
		return;
	}

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || bindings?.length !== 1) {
			return;
		}

		const path = bindings[0];
		const declarationPath = getAncestorPath(path, "ImportDeclaration");
		const specifier = path.parent?.node;
		if (!declarationPath || !specifier || specifier.local !== path.node) {
			return;
		}

		return {
			declaration: declarationPath.node,
			declarationPath,
			imported: getImportedName(specifier),
			kind: getImportKind(declarationPath.node, specifier),
			local,
			scope,
			source: declarationPath.node.source.value,
			specifier,
		};
	} catch {
		return;
	}
};

const getContextValueBinding = (identifierPath) => {
	const local = identifierPath.node?.name;
	if (!local) {
		return;
	}

	try {
		const scope = identifierPath.scope?.lookup(local);
		const bindings = scope?.getBindings()[local];
		if (!scope || !bindings?.length) {
			return;
		}

		const owned = [];
		for (const path of bindings) {
			const reference = path.node?.typeAnnotation?.typeAnnotation;
			if (
				reference?.type !== "TSTypeReference" ||
				reference.typeName?.type !== "TSQualifiedName" ||
				reference.typeName.left?.type !== "Identifier" ||
				reference.typeName.right?.type !== "Identifier" ||
				reference.typeName.right.name !== "Context"
			) {
				continue;
			}

			const binding = getImportBinding(
				path.get("typeAnnotation", "typeAnnotation", "typeName", "left"),
			);
			if (
				binding?.specifier.type === "ImportSpecifier" &&
				binding.imported === "Context" &&
				EFFECT_SOURCES.has(binding.source)
			) {
				owned.push({ path, reference });
			}
		}
		if (!owned.length) {
			return;
		}

		const candidate = owned[0];
		const owner = candidate.path.parent?.node;
		const parameters = candidate.reference.typeArguments ?? candidate.reference.typeParameters;
		return {
			owned: true,
			supported:
				bindings.length === 1 &&
				owned.length === 1 &&
				parameters?.params.length === 1 &&
				((owner?.type === "VariableDeclarator" && owner.id === candidate.path.node) ||
					(owner?.params?.includes(candidate.path.node) ?? false)),
		};
	} catch {
		return;
	}
};

const isStringLiteral = (node) =>
	(node?.type === "StringLiteral" || node?.type === "Literal") &&
	typeof node.value === "string";

const getMemberName = (node) => {
	if (node.type === "TSQualifiedName") {
		return node.right?.type === "Identifier" ? node.right.name : undefined;
	}
	if (!node.computed && node.property?.type === "Identifier") {
		return node.property.name;
	}
	if (node.computed && isStringLiteral(node.property)) {
		return node.property.value;
	}
};

const hasImportAncestor = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (parent.node.type === "ImportDeclaration") {
			return true;
		}
	}
	return false;
};

const NON_REFERENCE_KEYS = new Set([
	"ClassMethod",
	"ClassProperty",
	"MethodDefinition",
	"ObjectMethod",
	"ObjectProperty",
	"Property",
	"PropertyDefinition",
	"TSMethodSignature",
	"TSPropertySignature",
]);

const isReferenceIdentifier = (path) => {
	const parent = path.parent?.node;
	if (!parent || hasImportAncestor(path)) {
		return false;
	}
	if (
		(parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
		parent.property === path.node &&
		!parent.computed
	) {
		return false;
	}
	if (parent.type === "TSQualifiedName" && parent.right === path.node) {
		return false;
	}
	if (NON_REFERENCE_KEYS.has(parent.type) && parent.key === path.node && !parent.computed) {
		return false;
	}
	return true;
};

const getReferences = (root, j, binding) => {
	try {
		return root
			.find(j.Identifier, { name: binding.local })
			.paths()
			.filter(
				(path) =>
					isReferenceIdentifier(path) && path.scope?.lookup(binding.local) === binding.scope,
			);
	} catch {
		return;
	}
};

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (from[key]?.length) {
			to[key] = [...from[key]];
		}
	}
};

const hasTypeArguments = (node) => Boolean(node.typeArguments || node.typeParameters);

const isPipeCall = (node) =>
	node?.type === "CallExpression" &&
	node.callee?.type === "MemberExpression" &&
	!node.callee.computed &&
	!node.callee.optional &&
	node.callee.property?.type === "Identifier" &&
	node.callee.property.name === "pipe";

const isBarePipeArgument = (path) => {
	const parent = path.parent?.node;
	return isPipeCall(parent) && parent.arguments.includes(path.node);
};

const isDataLastPipeCall = (path) => {
	const parent = path.parent?.node;
	return isPipeCall(parent) && parent.arguments.includes(path.node);
};

const isExpressionArrow = (node) =>
	node?.type === "ArrowFunctionExpression" &&
	!node.async &&
	!node.generator &&
	node.params.length === 0 &&
	node.body.type !== "BlockStatement" &&
	!node.returnType &&
	!node.typeParameters;

const getObjectPropertyName = (node) =>
	!node.computed && node.key?.type === "Identifier" ? node.key.name : undefined;

const isDirectCall = (path) =>
	path.parent?.node.type === "CallExpression" && path.parent.node.callee === path.node;

const isSupportedCall = (node, argumentCount) =>
	node.arguments.length === argumentCount &&
	node.arguments.every((argument) => argument.type !== "SpreadElement") &&
	!node.optional &&
	!hasTypeArguments(node);

const isStableEffectExpression = (node) =>
	node?.type === "Identifier" ||
	(node?.type === "MemberExpression" &&
		!node.computed &&
		!node.optional &&
		node.property?.type === "Identifier" &&
		isStableEffectExpression(node.object));

const isContextMapper = (node) =>
	node?.type === "ArrowFunctionExpression" &&
	!node.async &&
	!node.generator &&
	node.params.length === 1 &&
	node.params[0].type === "Identifier" &&
	node.body.type !== "BlockStatement" &&
	!node.returnType &&
	!node.typeParameters;

const makeEffectMember = (j, local, member) =>
	j.memberExpression(j.identifier(local), j.identifier(member));

const makeIgnore = (j, local) =>
	j.callExpression(makeEffectMember(j, local, "ignore"), [
		j.objectExpression([j.objectProperty(j.identifier("log"), j.booleanLiteral(true))]),
	]);

const makeUnsandbox = (j, local) =>
	j.callExpression(makeEffectMember(j, local, "catch"), [
		j.arrowFunctionExpression(
			[j.identifier("cause")],
			j.callExpression(makeEffectMember(j, local, "failCause"), [j.identifier("cause")]),
		),
	]);

export default function coreStructural(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[core-structural] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const changes = [];
	const fiberBindings = new Map();
	const semaphoreGroups = new Map();
	let failure;

	const fail = (reason) => {
		failure ??= reason;
	};

	const memberPaths = root
		.find(j.Node)
		.paths()
		.filter((path) =>
			["MemberExpression", "OptionalMemberExpression", "TSQualifiedName"].includes(
				path.node.type,
			),
		);

	for (const path of memberPaths) {
		const node = path.node;
		const identifierPath =
			node.type === "TSQualifiedName"
				? node.left?.type === "Identifier"
					? path.get("left")
					: undefined
				: node.object?.type === "Identifier"
					? path.get("object")
					: undefined;
		if (!identifierPath) {
			continue;
		}

		const member = getMemberName(node);
		if (member === "unsafeMap" && node.type !== "TSQualifiedName") {
			const contextBinding = getContextValueBinding(identifierPath);
			if (contextBinding?.owned) {
				if (
					!contextBinding.supported ||
					node.type !== "MemberExpression" ||
					node.computed ||
					node.optional ||
					node.property?.type !== "Identifier"
				) {
					fail("unsupported Context.Context unsafeMap usage");
					continue;
				}
				changes.push(() => {
					node.property.name = "mapUnsafe";
				});
				continue;
			}
		}

		const binding = getImportBinding(identifierPath);
		if (
			binding?.specifier.type !== "ImportSpecifier" ||
			!EFFECT_SOURCES.has(binding.source) ||
			(binding.imported !== "Effect" &&
				binding.imported !== "Fiber" &&
				binding.imported !== "Stream")
		) {
			continue;
		}

		const owned =
			(binding.imported === "Effect" && EFFECT_MEMBERS.has(member)) ||
			(binding.imported === "Fiber" && member === "interruptFork") ||
			(binding.imported === "Stream" && member === "as");
		if (!owned) {
			continue;
		}

		if (binding.imported === "Stream") {
			const callPath = path.parent;
			if (
				binding.kind !== "value" ||
				node.type !== "MemberExpression" ||
				node.computed ||
				node.optional ||
				node.property?.type !== "Identifier" ||
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 1) ||
				callPath.node.arguments[0].type !== "Identifier" ||
				!isDataLastPipeCall(callPath)
			) {
				fail("unsupported Stream.as usage");
				continue;
			}

			const value = callPath.node.arguments[0];
			changes.push(() => {
				node.property.name = "map";
				callPath.node.arguments = [j.arrowFunctionExpression([], value)];
			});
			continue;
		}

		if (node.type === "TSQualifiedName") {
			const parent = path.parent?.node;
			if (
				binding.imported !== "Effect" ||
				member !== "Semaphore" ||
				parent?.type !== "TSTypeReference" ||
				parent.typeName !== node ||
				parent.typeArguments ||
				parent.typeParameters
			) {
				fail(`unsupported ${binding.imported}.${member} usage`);
				continue;
			}

			const group = semaphoreGroups.get(binding.source) ?? {
				plans: [],
				source: binding.source,
			};
			group.plans.push({ binding, kind: "type", path });
			semaphoreGroups.set(binding.source, group);
			continue;
		}

		if (
			node.type !== "MemberExpression" ||
			node.computed ||
			node.optional ||
			node.property?.type !== "Identifier"
		) {
			fail(`unsupported member syntax ${binding.imported}.${member}`);
			continue;
		}
		if (binding.kind !== "value") {
			fail(`unsupported type-only ${binding.imported}.${member} usage`);
			continue;
		}

		if (binding.imported === "Fiber") {
			const callPath = path.parent;
			const yieldPath = callPath?.parent;
			const statementPath = yieldPath?.parent;
			if (
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 1) ||
				callPath.node.arguments[0].type !== "Identifier" ||
				yieldPath?.node.type !== "YieldExpression" ||
				!yieldPath.node.delegate ||
				yieldPath.node.argument !== callPath.node ||
				statementPath?.node.type !== "ExpressionStatement" ||
				statementPath.node.expression !== yieldPath.node
			) {
				fail("unsupported Fiber.interruptFork usage");
				continue;
			}

			const fiber = callPath.node.arguments[0];
			changes.push(() => {
				const replacement = j.callExpression(
					j.memberExpression(fiber, j.identifier("interruptUnsafe")),
					[],
				);
				copyComments(callPath.node, replacement);
				copyComments(yieldPath.node, replacement);
				yieldPath.replace(replacement);
			});
			const group = fiberBindings.get(binding.specifier) ?? { binding, targets: new Set() };
			group.targets.add(identifierPath.node);
			fiberBindings.set(binding.specifier, group);
			continue;
		}

		if (member === "mapInputContext") {
			const callPath = path.parent;
			const effect = callPath?.node.arguments?.[0];
			const mapper = callPath?.node.arguments?.[1];
			if (
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 2) ||
				!isStableEffectExpression(effect) ||
				!isContextMapper(mapper)
			) {
				fail("unsupported Effect.mapInputContext usage");
				continue;
			}
			changes.push(() => {
				const body = j.callExpression(makeEffectMember(j, binding.local, "setContext"), [
					effect,
					mapper.body,
				]);
				const callback = j.arrowFunctionExpression(mapper.params, body);
				const callee = makeEffectMember(j, binding.local, "contextWith");
				const replacement = j.callExpression(callee, [callback]);
				copyComments(node.object, callee.object);
				copyComments(node.property, callee.property);
				copyComments(node, callee);
				copyComments(mapper, callback);
				copyComments(callPath.node, replacement);
				callPath.replace(replacement);
			});
			continue;
		}

		if (member === "dieMessage") {
			const callPath = path.parent;
			if (
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 1) ||
				path.scope?.lookup("Error")
			) {
				fail("unsupported Effect.dieMessage usage");
				continue;
			}
			changes.push(() => {
				node.property.name = "die";
				callPath.node.arguments = [
					j.newExpression(j.identifier("Error"), [callPath.node.arguments[0]]),
				];
			});
			continue;
		}

		if (member === "ignoreLogged") {
			if (!isBarePipeArgument(path)) {
				fail("unsupported Effect.ignoreLogged usage");
				continue;
			}
			changes.push(() => {
				const replacement = makeIgnore(j, binding.local);
				copyComments(node, replacement);
				path.replace(replacement);
			});
			continue;
		}

		if (member === "timeoutFail") {
			const callPath = path.parent;
			const options = callPath?.node.arguments?.[0];
			const properties = options?.type === "ObjectExpression" ? options.properties : [];
			const duration = properties.find((property) => getObjectPropertyName(property) === "duration");
			const onTimeout = properties.find(
				(property) => getObjectPropertyName(property) === "onTimeout",
			);
			const supportedProperties =
				properties.length === 2 &&
				properties.every(
					(property) =>
						property.type === "ObjectProperty" &&
						!property.computed &&
						!property.method &&
						!property.shorthand &&
						["duration", "onTimeout"].includes(getObjectPropertyName(property)),
				);
			if (
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 1) ||
				!isDataLastPipeCall(callPath) ||
				!supportedProperties ||
				!duration ||
				!onTimeout ||
				!isExpressionArrow(onTimeout.value)
			) {
				fail("unsupported Effect.timeoutFail usage");
				continue;
			}
			changes.push(() => {
				node.property.name = "timeoutOrElse";
				onTimeout.key.name = "orElse";
				onTimeout.value.body = j.callExpression(makeEffectMember(j, binding.local, "fail"), [
					onTimeout.value.body,
				]);
			});
			continue;
		}

		if (member === "orElse") {
			const callPath = path.parent;
			if (
				!isDirectCall(path) ||
				!isSupportedCall(callPath.node, 1) ||
				!isDataLastPipeCall(callPath) ||
				!isExpressionArrow(callPath.node.arguments[0])
			) {
				fail("unsupported Effect.orElse usage");
				continue;
			}
			changes.push(() => {
				node.property.name = "catch";
			});
			continue;
		}

		if (member === "makeSemaphore") {
			const callPath = path.parent;
			if (!isDirectCall(path) || !isSupportedCall(callPath.node, 1)) {
				fail("unsupported Effect.makeSemaphore usage");
				continue;
			}
			const group = semaphoreGroups.get(binding.source) ?? {
				plans: [],
				source: binding.source,
			};
			group.plans.push({ binding, kind: "value", path });
			semaphoreGroups.set(binding.source, group);
			continue;
		}

		if (member === "optionFromOptional") {
			const callPath = path.parent;
			if (!isDirectCall(path) || !isSupportedCall(callPath.node, 1)) {
				fail("unsupported Effect.optionFromOptional usage");
				continue;
			}
			changes.push(() => {
				node.property.name = "catchNoSuchElement";
			});
			continue;
		}

		if (member === "unsandbox") {
			if (!isBarePipeArgument(path)) {
				fail("unsupported Effect.unsandbox usage");
				continue;
			}
			changes.push(() => {
				const replacement = makeUnsandbox(j, binding.local);
				copyComments(node, replacement);
				path.replace(replacement);
			});
		}
	}

	for (const group of semaphoreGroups.values()) {
		const needsValue = group.plans.some((plan) => plan.kind === "value");
		let existing;

		for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
			if (declarationPath.node.source.value !== group.source) {
				continue;
			}
			for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
				const specifierPath = declarationPath.get("specifiers", index);
				const specifier = specifierPath.node;
				if (
					specifier.type !== "ImportSpecifier" ||
					getImportedName(specifier) !== "Semaphore" ||
					(needsValue && getImportKind(declarationPath.node, specifier) !== "value")
				) {
					continue;
				}
				const binding = getImportBinding(specifierPath.get("local"));
				if (
					binding &&
					group.plans.every((plan) => plan.path.scope?.lookup(binding.local) === binding.scope)
				) {
					existing = binding;
					break;
				}
			}
			if (existing) {
				break;
			}
		}

		if (existing) {
			group.local = existing.local;
			continue;
		}

		const anchor =
			group.plans.find((plan) => plan.binding.kind === "value")?.binding ??
			group.plans[0]?.binding;
		if (
			!anchor ||
			anchor.declaration.assertions?.length ||
			anchor.declaration.attributes?.length ||
			!anchor.declaration.specifiers?.every((specifier) => specifier.type === "ImportSpecifier")
		) {
			fail(`unsupported Semaphore import from ${group.source}`);
			continue;
		}

		let suffix = 0;
		let local;
		do {
			local = suffix === 0 ? "Semaphore" : suffix === 1 ? "EffectSemaphore" : `EffectSemaphore${suffix}`;
			suffix += 1;
		} while (group.plans.some((plan) => plan.path.scope?.lookup(local)));

		group.importPlan = { binding: anchor, kind: needsValue ? "value" : "type" };
		group.local = local;
	}

	for (const group of fiberBindings.values()) {
		const references = getReferences(root, j, group.binding);
		if (references?.length && references.every((path) => group.targets.has(path.node))) {
			changes.push(() => {
				const declarationPath = group.binding.declarationPath;
				declarationPath.node.specifiers = declarationPath.node.specifiers.filter(
					(specifier) => specifier !== group.binding.specifier,
				);
				if (!declarationPath.node.specifiers.length) {
					declarationPath.prune();
				}
			});
		}
	}

	if (failure) {
		api.report(`[core-structural] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (!changes.length && !semaphoreGroups.size) {
		return;
	}

	for (const change of changes) {
		change();
	}
	for (const group of semaphoreGroups.values()) {
		if (group.importPlan) {
			const local = group.local === "Semaphore" ? null : j.identifier(group.local);
			const specifier = j.importSpecifier(j.identifier("Semaphore"), local);
			if (
				group.importPlan.kind === "type" &&
				group.importPlan.binding.declaration.importKind !== "type"
			) {
				specifier.importKind = "type";
			}
			group.importPlan.binding.declaration.specifiers.push(specifier);
		}
		for (const plan of group.plans) {
			if (plan.kind === "type") {
				plan.path.node.left.name = group.local;
			} else {
				plan.path.node.object.name = group.local;
				plan.path.node.property.name = "make";
			}
		}
	}

	api.report(`[core-structural] transformed ${repositoryPath}`);
	return root.toSource();
}
