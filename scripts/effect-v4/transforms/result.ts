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
const REPOSITORY_ROOT = process.cwd();

const EITHER_MEMBER_RENAMES = new Map([
	["Either", "Result"],
	["getLeft", "getFailure"],
	["getOrThrow", "getOrThrow"],
	["getOrThrowWith", "getOrThrowWith"],
	["getRight", "getSuccess"],
	["isLeft", "isFailure"],
	["isRight", "isSuccess"],
	["left", "fail"],
	["right", "succeed"],
	["try", "try"],
]);
const RESULT_CONSTRUCTORS = new Set(["left", "right", "try"]);
const RESULT_GUARDS = new Set(["isLeft", "isRight"]);
const TAG_RENAMES = new Map([
	["Left", "Failure"],
	["Right", "Success"],
]);
const VARIANT_FIELD_RENAMES = new Map([
	["left", "failure"],
	["right", "success"],
]);

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

const getAncestorPath = (path, type) => {
	for (let parent = path; parent; parent = parent.parent) {
		if (parent.node?.type === type) {
			return parent;
		}
	}
};

const getImportKind = (declaration, specifier) =>
	declaration.importKind === "type" || specifier.importKind === "type" ? "type" : "value";

const getExportKind = (declaration, specifier) =>
	declaration.exportKind === "type" || specifier.exportKind === "type" ? "type" : "value";

const isStringLiteral = (node, value) =>
	(node?.type === "StringLiteral" || node?.type === "Literal") &&
	typeof node.value === "string" &&
	(value === undefined || node.value === value);

const getNodeName = (node) => {
	if (node?.type === "Identifier") {
		return node.name;
	}
	if (isStringLiteral(node)) {
		return node.value;
	}
};

const setStringValue = (node, value) => {
	const quote = node.extra?.raw?.startsWith("'") ? "'" : '"';
	node.value = value;
	if (node.extra) {
		node.extra.raw = `${quote}${value}${quote}`;
		node.extra.rawValue = value;
	}
	if ("raw" in node) {
		node.raw = `${quote}${value}${quote}`;
	}
};

const setNodeName = (node, value) => {
	if (node.type === "Identifier") {
		node.name = value;
	} else {
		setStringValue(node, value);
	}
};

const getMemberName = (node) => {
	if (!node?.computed && node.property?.type === "Identifier") {
		return node.property.name;
	}
	if (node?.computed && isStringLiteral(node.property)) {
		return node.property.value;
	}
};

const getPropertyName = (node) => {
	if (!node?.computed && node.key?.type === "Identifier") {
		return node.key.name;
	}
	if (!node?.computed && isStringLiteral(node.key)) {
		return node.key.value;
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
	if (parent.type === "ExportSpecifier" && parent.exported === path.node) {
		return false;
	}
	if (
		(parent.type === "LabeledStatement" ||
			parent.type === "BreakStatement" ||
			parent.type === "ContinueStatement") &&
		parent.label === path.node
	) {
		return false;
	}
	if (NON_REFERENCE_KEYS.has(parent.type) && parent.key === path.node && !parent.computed) {
		return false;
	}
	return true;
};

const LEXICAL_CONTAINER_TYPES = new Set([
	"ArrowFunctionExpression",
	"BlockStatement",
	"CatchClause",
	"ClassBody",
	"ForInStatement",
	"ForOfStatement",
	"ForStatement",
	"FunctionDeclaration",
	"FunctionExpression",
	"Program",
	"SwitchStatement",
	"TSModuleBlock",
]);

const getLexicalContainer = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (LEXICAL_CONTAINER_TYPES.has(parent.node?.type)) {
			return parent.node;
		}
	}
};

const getBinding = (identifierPath) => {
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
		if (bindings.length === 1) {
			return { path: bindings[0], scope };
		}

		const ancestors = new Map();
		let distance = 0;
		for (let parent = identifierPath; parent; parent = parent.parent) {
			ancestors.set(parent.node, distance);
			distance += 1;
		}
		const candidates = bindings
			.map((path) => ({ distance: ancestors.get(getLexicalContainer(path)), path }))
			.filter((candidate) => candidate.distance !== undefined)
			.sort((left, right) => left.distance - right.distance);
		if (!candidates.length || candidates[0].distance === candidates[1]?.distance) {
			return;
		}
		return { path: candidates[0].path, scope };
	} catch {
		return;
	}
};

const getImportBinding = (identifierPath) => {
	const binding = getBinding(identifierPath);
	const declarationPath = binding && getAncestorPath(binding.path, "ImportDeclaration");
	const specifier = binding?.path.parent?.node;
	if (!declarationPath || !specifier || specifier.local !== binding.path.node) {
		return;
	}
	return {
		...binding,
		declaration: declarationPath.node,
		imported: getNodeName(specifier.imported),
		kind: getImportKind(declarationPath.node, specifier),
		source: declarationPath.node.source.value,
		specifier,
	};
};

const getReferences = (root, j, local, scope) =>
	root
		.find(j.Identifier, { name: local })
		.paths()
		.filter((path) => isReferenceIdentifier(path) && path.scope?.lookup(local) === scope);

const copyComments = (from, to) => {
	for (const key of ["comments", "leadingComments", "trailingComments", "innerComments"]) {
		if (!from[key]?.length) {
			continue;
		}
		to[key] = [...(to[key] ?? []), ...from[key]];
	}
};

const unwrapExpression = (node) => {
	let current = node;
	while (
		current &&
		[
			"ParenthesizedExpression",
			"TSAsExpression",
			"TSInstantiationExpression",
			"TSNonNullExpression",
			"TSSatisfiesExpression",
			"TSTypeAssertion",
		].includes(current.type)
	) {
		current = current.expression;
	}
	return current;
};

const isMemberPath = (path) =>
	path.node.type === "MemberExpression" || path.node.type === "OptionalMemberExpression";

const isImportedMember = (path, imported, member) => {
	if (
		!isMemberPath(path) ||
		path.node.computed ||
		path.node.optional ||
		path.node.object?.type !== "Identifier" ||
		path.node.property?.type !== "Identifier" ||
		path.node.property.name !== member
	) {
		return false;
	}
	const binding = getImportBinding(path.get("object"));
	return (
		binding?.specifier.type === "ImportSpecifier" &&
		EFFECT_SOURCES.has(binding.source) &&
		binding.imported === imported &&
		binding.kind === "value"
	);
};

const getPatternProperties = (patternPath) => {
	if (patternPath.node?.type !== "ObjectPattern") {
		return [];
	}
	return patternPath.node.properties.map((_, index) => patternPath.get("properties", index));
};

const renameProperty = (j, property, name) => {
	if (property.shorthand) {
		property.shorthand = false;
		property.key = j.identifier(name);
		return;
	}
	setNodeName(property.key, name);
};

const findExpectationTagMember = (node) => {
	const current = unwrapExpression(node);
	if (!current) {
		return;
	}
	if (
		current.type === "CallExpression" &&
		current.callee?.type === "Identifier" &&
		current.callee.name === "expect" &&
		current.arguments.length === 1
	) {
		const argument = unwrapExpression(current.arguments[0]);
		if (
			(argument?.type === "MemberExpression" || argument?.type === "OptionalMemberExpression") &&
			!argument.computed &&
			argument.property?.type === "Identifier" &&
			argument.property.name === "_tag"
		) {
			return argument;
		}
	}
	if (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
		return findExpectationTagMember(current.object);
	}
	if (current.type === "CallExpression") {
		return findExpectationTagMember(current.callee);
	}
};

const buildProgramPlan = (root, j) => {
	let failure;
	const fail = (reason) => {
		failure ??= reason;
	};

	const importPlans = [];
	const exportPlans = [];
	const eitherMembers = new Map();
	const existingResultImports = new Set();
	const existingResultExports = new Set();
	const localExportDedupePlans = [];

	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!EFFECT_SOURCES.has(declarationPath.node.source.value)) {
			continue;
		}
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (specifier.type !== "ImportSpecifier") {
				continue;
			}
			const imported = getNodeName(specifier.imported);
			if (imported === "Result") {
				existingResultImports.add(specifier);
				continue;
			}
			if (imported !== "Either" || specifier.local?.type !== "Identifier") {
				continue;
			}

			const localPath = specifierPath.get("local");
			const local = specifier.local.name;
			const binding = getBinding(localPath);
			if (!binding || binding.path.node !== specifier.local) {
				fail(`unsupported Either import binding ${local}`);
				continue;
			}
			const references = getReferences(root, j, local, binding.scope);
			const plan = {
				binding,
				declarationPath,
				kind: getImportKind(declarationPath.node, specifier),
				local,
				references,
				source: declarationPath.node.source.value,
				specifier,
			};
			importPlans.push(plan);

			for (const reference of references) {
				const parent = reference.parent?.node;
				if (
					(parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") &&
					parent.object === reference.node
				) {
					const member = getMemberName(parent);
					if (!member || !EITHER_MEMBER_RENAMES.has(member)) {
						fail(`unsupported Either member ${member ?? "<computed>"}`);
						continue;
					}
					if (
						parent.type !== "MemberExpression" ||
						parent.computed ||
						parent.optional ||
						parent.property?.type !== "Identifier"
					) {
						fail(`unsupported Either member shape ${member}`);
						continue;
					}
					if (plan.kind === "type" && member !== "Either") {
						fail(`value member ${member} used through type-only Either import`);
						continue;
					}
					const usage = reference.parent.parent?.node;
					const directCall = usage?.type === "CallExpression" && usage.callee === parent;
					const findPredicate =
						RESULT_GUARDS.has(member) &&
						usage?.type === "CallExpression" &&
						usage.arguments.includes(parent) &&
						usage.callee?.type === "MemberExpression" &&
						!usage.callee.computed &&
						usage.callee.property?.type === "Identifier" &&
						usage.callee.property.name === "find";
					if (member === "Either" || (!directCall && !findPredicate)) {
						fail(`unsupported Either member reference ${member}`);
						continue;
					}
					eitherMembers.set(parent, {
						member,
						path: reference.parent,
						rename: EITHER_MEMBER_RENAMES.get(member),
					});
					continue;
				}
				if (
					parent?.type === "TSQualifiedName" &&
					parent.left === reference.node &&
					parent.right?.type === "Identifier"
				) {
					if (parent.right.name !== "Either") {
						fail(`unsupported Either type member ${parent.right.name}`);
						continue;
					}
					eitherMembers.set(parent, {
						member: "Either",
						path: reference.parent,
						rename: "Result",
					});
					continue;
				}
				if (parent?.type === "ExportSpecifier" && parent.local === reference.node) {
					continue;
				}
				fail(`unsupported reference to Either binding ${local}`);
			}
		}
	}

	for (const declarationPath of root.find(j.ExportNamedDeclaration).paths()) {
		if (!EFFECT_SOURCES.has(declarationPath.node.source?.value)) {
			continue;
		}
		for (const specifier of declarationPath.node.specifiers ?? []) {
			if (specifier.type !== "ExportSpecifier") {
				continue;
			}
			const exported = getNodeName(specifier.exported);
			const local = getNodeName(specifier.local);
			if (local === "Result") {
				existingResultExports.add(specifier);
			} else if (local === "Either") {
				exportPlans.push({ declarationPath, exported, specifier });
			}
		}
	}

	const acceptedResultBindings = new Map();
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!EFFECT_SOURCES.has(declarationPath.node.source.value)) {
			continue;
		}
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (
				specifier.type !== "ImportSpecifier" ||
				getNodeName(specifier.imported) !== "Result" ||
				specifier.local?.name !== "Result"
			) {
				continue;
			}
			acceptedResultBindings.set(specifier.local, {
				kind: getImportKind(declarationPath.node, specifier),
				source: declarationPath.node.source.value,
			});
		}
	}

	for (const plan of importPlans) {
		if (plan.local !== "Either") {
			continue;
		}
		for (const reference of [
			plan.declarationPath.get(
				"specifiers",
				plan.declarationPath.node.specifiers.indexOf(plan.specifier),
				"local",
			),
			...plan.references,
		]) {
			const resultScope = reference.scope?.lookup("Result");
			if (!resultScope) {
				continue;
			}
			const bindings = resultScope.getBindings().Result ?? [];
			const accepted =
				resultScope === plan.binding.scope &&
				bindings.length > 0 &&
				bindings.every((binding) => {
					const existing = acceptedResultBindings.get(binding.node);
					return existing?.source === plan.source && existing.kind === plan.kind;
				});
			if (!accepted) {
				fail("binding Result would collide while renaming Either");
			}
		}
	}

	const namedExports = [];
	for (const declarationPath of root.find(j.ExportNamedDeclaration).paths()) {
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (specifier.type !== "ExportSpecifier") {
				continue;
			}
			const exported = getNodeName(specifier.exported);
			let renamed =
				exported === "Either" &&
				EFFECT_SOURCES.has(declarationPath.node.source?.value) &&
				getNodeName(specifier.local) === "Either";
			if (
				exported === "Either" &&
				!declarationPath.node.source &&
				specifier.local?.type === "Identifier"
			) {
				const binding = getImportBinding(specifierPath.get("local"));
				renamed =
					binding?.specifier.type === "ImportSpecifier" &&
					EFFECT_SOURCES.has(binding.source) &&
					binding.imported === "Either" &&
					binding.specifier.local?.name === "Either";
			}
			namedExports.push({ declaration: declarationPath.node, exported, renamed });
		}
	}
	if (
		namedExports.some(
			(entry) =>
				entry.renamed &&
				namedExports.some(
					(existing) =>
						existing.exported === "Result" && existing.declaration !== entry.declaration,
				),
		)
	) {
		fail("cross-declaration Result export collision");
	}

	const localExportGroups = new Map();
	for (const declarationPath of root.find(j.ExportNamedDeclaration).paths()) {
		if (declarationPath.node.source || declarationPath.node.declaration) {
			continue;
		}
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (
				specifier.type !== "ExportSpecifier" ||
				specifier.local?.type !== "Identifier" ||
				!getNodeName(specifier.exported)
			) {
				continue;
			}
			const binding = getImportBinding(specifierPath.get("local"));
			const accepted =
				binding?.specifier.type === "ImportSpecifier" &&
				EFFECT_SOURCES.has(binding.source) &&
				(binding.imported === "Either" || binding.imported === "Result");
			const migrated = accepted && binding.imported === "Either";
			const exported =
				migrated &&
				binding.specifier.local?.name === "Either" &&
				getNodeName(specifier.exported) === "Either"
					? "Result"
					: getNodeName(specifier.exported);
			const key = [getExportKind(declarationPath.node, specifier), exported].join("\0");
			const entries = localExportGroups.get(key) ?? [];
			entries.push({
				declarationPath,
				identity: accepted ? [binding.source, binding.kind, "Result"].join("\0") : undefined,
				migrated,
				specifier,
			});
			localExportGroups.set(key, entries);
		}
	}
	for (const entries of localExportGroups.values()) {
		if (entries.length < 2 || !entries.some((entry) => entry.migrated)) {
			continue;
		}
		const identities = new Set(entries.map((entry) => entry.identity));
		if (identities.size !== 1 || identities.has(undefined)) {
			fail("unsafe local Result export collision");
			continue;
		}
		localExportDedupePlans.push(entries);
	}
	const effectEitherPlans = [];
	for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
		if (!EFFECT_SOURCES.has(declarationPath.node.source.value)) {
			continue;
		}
		for (let index = 0; index < (declarationPath.node.specifiers?.length ?? 0); index += 1) {
			const specifierPath = declarationPath.get("specifiers", index);
			const specifier = specifierPath.node;
			if (
				specifier.type !== "ImportSpecifier" ||
				getNodeName(specifier.imported) !== "Effect" ||
				specifier.local?.type !== "Identifier"
			) {
				continue;
			}
			const localPath = specifierPath.get("local");
			const binding = getBinding(localPath);
			if (!binding || binding.path.node !== specifier.local) {
				fail(`unsupported Effect import binding ${specifier.local.name}`);
				continue;
			}
			for (const reference of getReferences(root, j, specifier.local.name, binding.scope)) {
				const memberPath = reference.parent;
				const member = memberPath?.node;
				if (
					(member?.type !== "MemberExpression" && member?.type !== "OptionalMemberExpression") ||
					member.object !== reference.node ||
					getMemberName(member) !== "either"
				) {
					continue;
				}
				if (
					getImportKind(declarationPath.node, specifier) !== "value" ||
					member.type !== "MemberExpression" ||
					member.computed ||
					member.optional ||
					member.property?.type !== "Identifier"
				) {
					fail("unsupported Effect.either member shape");
					continue;
				}
				const callPath = memberPath.parent;
				const direct = callPath?.node.type === "CallExpression" && callPath.node.callee === member;
				const pipeArgument =
					callPath?.node.type === "CallExpression" &&
					callPath.node.arguments.includes(member) &&
					((callPath.node.callee?.type === "Identifier" && callPath.node.callee.name === "pipe") ||
						(callPath.node.callee?.type === "MemberExpression" &&
							!callPath.node.callee.computed &&
							callPath.node.callee.property?.type === "Identifier" &&
							callPath.node.callee.property.name === "pipe"));
				if (!direct && !pipeArgument) {
					fail("unsupported Effect.either usage");
					continue;
				}
				effectEitherPlans.push({ call: callPath.node, path: memberPath });
			}
		}
	}

	const memberPaths = root
		.find(j.Node)
		.paths()
		.filter((path) => isMemberPath(path));
	const cronParseMembers = new Set();
	const effectRunPromiseMembers = new Set();
	const effectRunSyncMembers = new Set();
	const schemaDecoderMembers = new Set();
	for (const memberPath of memberPaths) {
		if (isImportedMember(memberPath, "Cron", "parse")) {
			cronParseMembers.add(memberPath.node);
		}
		if (isImportedMember(memberPath, "Effect", "runPromise")) {
			effectRunPromiseMembers.add(memberPath.node);
		}
		if (isImportedMember(memberPath, "Effect", "runSync")) {
			effectRunSyncMembers.add(memberPath.node);
		}
		if (isImportedMember(memberPath, "Schema", "decodeUnknownEither")) {
			schemaDecoderMembers.add(memberPath.node);
		}
	}

	const effectCalls = new Set(effectEitherPlans.map((plan) => plan.call));
	const constructorCalls = new Set();
	const findCalls = new Set();
	const guardCalls = new Set();
	const typeMembers = new Set();
	for (const [node, info] of eitherMembers) {
		if (node.type === "TSQualifiedName") {
			typeMembers.add(node);
			continue;
		}
		const parent = info.path.parent?.node;
		if (parent?.type === "CallExpression" && parent.callee === node) {
			if (RESULT_CONSTRUCTORS.has(info.member)) {
				constructorCalls.add(parent);
			}
			if (RESULT_GUARDS.has(info.member)) {
				guardCalls.add(parent);
			}
		} else if (
			RESULT_GUARDS.has(info.member) &&
			parent?.type === "CallExpression" &&
			parent.arguments.includes(node) &&
			parent.callee?.type === "MemberExpression" &&
			!parent.callee.computed &&
			parent.callee.property?.type === "Identifier" &&
			parent.callee.property.name === "find"
		) {
			findCalls.add(parent);
		}
	}

	const identifierBindings = new Map();
	root.find(j.Identifier).forEach((path) => {
		const binding = getBinding(path);
		if (binding) {
			identifierBindings.set(path.node, binding.path.node);
		}
	});

	const schemaFactoryCalls = new Set();
	for (const member of schemaDecoderMembers) {
		const path = memberPaths.find((candidate) => candidate.node === member);
		if (path?.parent?.node.type === "CallExpression" && path.parent.node.callee === member) {
			schemaFactoryCalls.add(path.parent.node);
		}
	}

	const decoderBindings = new Set();
	let decoderChanged = true;
	while (decoderChanged) {
		decoderChanged = false;
		for (const declarationPath of root.find(j.VariableDeclarator).paths()) {
			if (declarationPath.node.id?.type !== "Identifier" || !declarationPath.node.init) {
				continue;
			}
			const binding = identifierBindings.get(declarationPath.node.id);
			const init = unwrapExpression(declarationPath.node.init);
			const sourceBinding = init?.type === "Identifier" && identifierBindings.get(init);
			if (
				binding &&
				!decoderBindings.has(binding) &&
				(schemaFactoryCalls.has(init) || (sourceBinding && decoderBindings.has(sourceBinding)))
			) {
				decoderBindings.add(binding);
				decoderChanged = true;
			}
		}
	}

	const isSchemaResultCall = (node) => {
		if (node?.type !== "CallExpression") {
			return false;
		}
		const callee = unwrapExpression(node.callee);
		if (callee?.type === "CallExpression" && schemaFactoryCalls.has(callee)) {
			return true;
		}
		return callee?.type === "Identifier" && decoderBindings.has(identifierBindings.get(callee));
	};

	const isEffectComputation = (node) => effectCalls.has(unwrapExpression(node));
	const markedBindings = new Set();
	const touchedBindings = new Set();
	const typedPatterns = new Set();
	const markBinding = (node) => {
		const binding = identifierBindings.get(node);
		if (!binding || markedBindings.has(binding)) {
			return false;
		}
		markedBindings.add(binding);
		return true;
	};
	const markCarrierBindings = (node) => {
		const current = unwrapExpression(node);
		if (!current) {
			return false;
		}
		if (current.type === "Identifier") {
			return markBinding(current);
		}
		if (current.type === "ConditionalExpression") {
			const consequent = markCarrierBindings(current.consequent);
			const alternate = markCarrierBindings(current.alternate);
			return consequent || alternate;
		}
		if (current.type === "LogicalExpression") {
			const left = markCarrierBindings(current.left);
			const right = markCarrierBindings(current.right);
			return left || right;
		}
		if (current.type === "SequenceExpression") {
			return markCarrierBindings(current.expressions.at(-1));
		}
		return false;
	};

	const isOwnedValue = (node) => {
		const current = unwrapExpression(node);
		if (!current) {
			return false;
		}
		if (current.type === "Identifier") {
			return markedBindings.has(identifierBindings.get(current));
		}
		if (current.type === "CallExpression") {
			if (constructorCalls.has(current) || findCalls.has(current) || isSchemaResultCall(current)) {
				return true;
			}
			if (cronParseMembers.has(current.callee)) {
				return true;
			}
			if (effectRunSyncMembers.has(current.callee)) {
				return current.arguments.some(isEffectComputation);
			}
			return false;
		}
		if (current.type === "YieldExpression") {
			return isEffectComputation(current.argument);
		}
		if (current.type === "AwaitExpression") {
			const argument = unwrapExpression(current.argument);
			return (
				argument?.type === "CallExpression" &&
				effectRunPromiseMembers.has(argument.callee) &&
				argument.arguments.some(isEffectComputation)
			);
		}
		if (current.type === "ConditionalExpression") {
			return isOwnedValue(current.consequent) && isOwnedValue(current.alternate);
		}
		if (current.type === "LogicalExpression") {
			return isOwnedValue(current.left) && isOwnedValue(current.right);
		}
		if (current.type === "SequenceExpression") {
			return isOwnedValue(current.expressions.at(-1));
		}
		if (current.type === "AssignmentExpression") {
			return isOwnedValue(current.right);
		}
		return false;
	};

	for (const member of typeMembers) {
		const path = eitherMembers.get(member).path;
		const annotationPath = getAncestorPath(path, "TSTypeAnnotation");
		const ownerPath = annotationPath?.parent;
		if (ownerPath?.node.type === "Identifier") {
			markBinding(ownerPath.node);
		} else if (ownerPath?.node.type === "ObjectPattern") {
			typedPatterns.add(ownerPath.node);
		}
	}

	for (const call of guardCalls) {
		for (const argument of call.arguments) {
			if (argument?.type !== "SpreadElement") {
				markCarrierBindings(argument);
			}
		}
	}

	const tagPlans = new Set();
	const markTagMember = (member, literal) => {
		markCarrierBindings(member.object);
		const object = unwrapExpression(member.object);
		if (object?.type === "Identifier") {
			const binding = identifierBindings.get(object);
			if (binding) {
				touchedBindings.add(binding);
			}
		}
		tagPlans.add(literal);
	};
	for (const binaryPath of root.find(j.BinaryExpression).paths()) {
		if (!["==", "===", "!=", "!=="].includes(binaryPath.node.operator)) {
			continue;
		}
		for (const [member, literal] of [
			[binaryPath.node.left, binaryPath.node.right],
			[binaryPath.node.right, binaryPath.node.left],
		]) {
			if (
				(member?.type === "MemberExpression" || member?.type === "OptionalMemberExpression") &&
				!member.computed &&
				member.property?.type === "Identifier" &&
				member.property.name === "_tag" &&
				isStringLiteral(literal) &&
				TAG_RENAMES.has(literal.value)
			) {
				markTagMember(member, literal);
			}
		}
	}
	for (const callPath of root.find(j.CallExpression).paths()) {
		const [literal] = callPath.node.arguments;
		if (
			!isStringLiteral(literal) ||
			!TAG_RENAMES.has(literal.value) ||
			callPath.node.callee?.type !== "MemberExpression" ||
			callPath.node.callee.computed ||
			!["toBe", "toEqual", "toStrictEqual"].includes(callPath.node.callee.property?.name)
		) {
			continue;
		}
		const member = findExpectationTagMember(callPath.node.callee.object);
		if (member) {
			markTagMember(member, literal);
		}
	}
	for (const switchPath of root.find(j.SwitchStatement).paths()) {
		const member = unwrapExpression(switchPath.node.discriminant);
		if (
			(member?.type !== "MemberExpression" && member?.type !== "OptionalMemberExpression") ||
			member.computed ||
			member.property?.name !== "_tag"
		) {
			continue;
		}
		for (const branch of switchPath.node.cases) {
			if (isStringLiteral(branch.test) && TAG_RENAMES.has(branch.test.value)) {
				markTagMember(member, branch.test);
			}
		}
	}

	let bindingChanged = true;
	while (bindingChanged) {
		bindingChanged = false;
		for (const declarationPath of root.find(j.VariableDeclarator).paths()) {
			if (declarationPath.node.id?.type !== "Identifier" || !declarationPath.node.init) {
				continue;
			}
			const binding = identifierBindings.get(declarationPath.node.id);
			if (binding && isOwnedValue(declarationPath.node.init) && !markedBindings.has(binding)) {
				markedBindings.add(binding);
				bindingChanged = true;
			}
			if (markedBindings.has(binding)) {
				bindingChanged = markCarrierBindings(declarationPath.node.init) || bindingChanged;
			}
		}
		for (const assignmentPath of root.find(j.AssignmentExpression, { operator: "=" }).paths()) {
			if (assignmentPath.node.left?.type !== "Identifier") {
				continue;
			}
			const binding = identifierBindings.get(assignmentPath.node.left);
			if (binding && isOwnedValue(assignmentPath.node.right) && !markedBindings.has(binding)) {
				markedBindings.add(binding);
				bindingChanged = true;
			}
			if (markedBindings.has(binding)) {
				bindingChanged = markCarrierBindings(assignmentPath.node.right) || bindingChanged;
			}
		}
	}

	const variantMemberPlans = [];
	for (const memberPath of memberPaths) {
		const member = getMemberName(memberPath.node);
		if (!VARIANT_FIELD_RENAMES.has(member) || eitherMembers.has(memberPath.node)) {
			continue;
		}
		if (!isOwnedValue(memberPath.node.object)) {
			continue;
		}
		if (memberPath.node.computed || memberPath.node.property?.type !== "Identifier") {
			fail(`unsupported Result variant member shape ${member}`);
			continue;
		}
		const object = unwrapExpression(memberPath.node.object);
		if (object?.type === "Identifier") {
			const binding = identifierBindings.get(object);
			if (binding) {
				touchedBindings.add(binding);
			}
		}
		variantMemberPlans.push(memberPath);
	}

	const destructuringPlans = [];
	const collectPatternPlan = (patternPath) => {
		for (const propertyPath of getPatternProperties(patternPath)) {
			const property = propertyPath.node;
			const name =
				getPropertyName(property) ??
				(property.computed && isStringLiteral(property.key) ? property.key.value : undefined);
			if (!VARIANT_FIELD_RENAMES.has(name)) {
				continue;
			}
			if (
				(property.type !== "ObjectProperty" && property.type !== "Property") ||
				property.computed ||
				property.method ||
				(!property.shorthand && !property.value)
			) {
				fail(`unsupported Result destructuring property ${name}`);
				continue;
			}
			destructuringPlans.push(propertyPath);
		}
	};
	for (const declarationPath of root.find(j.VariableDeclarator).paths()) {
		if (
			declarationPath.node.id?.type === "ObjectPattern" &&
			isOwnedValue(declarationPath.node.init)
		) {
			const planCount = destructuringPlans.length;
			collectPatternPlan(declarationPath.get("id"));
			const init = unwrapExpression(declarationPath.node.init);
			if (destructuringPlans.length > planCount && init?.type === "Identifier") {
				const binding = identifierBindings.get(init);
				if (binding) {
					touchedBindings.add(binding);
				}
			}
		}
	}
	for (const assignmentPath of root.find(j.AssignmentExpression, { operator: "=" }).paths()) {
		if (
			assignmentPath.node.left?.type === "ObjectPattern" &&
			isOwnedValue(assignmentPath.node.right)
		) {
			const planCount = destructuringPlans.length;
			collectPatternPlan(assignmentPath.get("left"));
			const right = unwrapExpression(assignmentPath.node.right);
			if (destructuringPlans.length > planCount && right?.type === "Identifier") {
				const binding = identifierBindings.get(right);
				if (binding) {
					touchedBindings.add(binding);
				}
			}
		}
	}
	root.find(j.ObjectPattern).forEach((patternPath) => {
		if (typedPatterns.has(patternPath.node)) {
			collectPatternPlan(patternPath);
		}
	});

	for (const assignmentPath of root.find(j.AssignmentExpression).paths()) {
		if (
			assignmentPath.node.left?.type === "Identifier" &&
			touchedBindings.has(identifierBindings.get(assignmentPath.node.left)) &&
			(assignmentPath.node.operator !== "=" || !isOwnedValue(assignmentPath.node.right))
		) {
			fail(`unsupported reassignment of Result binding ${assignmentPath.node.left.name}`);
		}
	}
	for (const updatePath of root.find(j.UpdateExpression).paths()) {
		if (
			updatePath.node.argument?.type === "Identifier" &&
			touchedBindings.has(identifierBindings.get(updatePath.node.argument))
		) {
			fail(`unsupported update of Result binding ${updatePath.node.argument.name}`);
		}
	}

	const objectFieldPlans = [];
	for (const objectPath of root.find(j.ObjectExpression).paths()) {
		const properties = objectPath.node.properties.filter(
			(property) => property.type === "ObjectProperty" || property.type === "Property",
		);
		const tags = properties.filter((property) => getPropertyName(property) === "_tag");
		if (
			tags.length !== 1 ||
			!isStringLiteral(tags[0].value) ||
			!TAG_RENAMES.has(tags[0].value.value)
		) {
			continue;
		}
		const fieldName = tags[0].value.value === "Left" ? "left" : "right";
		const fields = properties.filter((property) => getPropertyName(property) === fieldName);
		if (!fields.length) {
			continue;
		}
		if (fields.length !== 1) {
			fail(`unsupported duplicate ${fieldName} field in Result variant object`);
			continue;
		}
		tagPlans.add(tags[0].value);
		objectFieldPlans.push(fields[0]);
	}

	const changed =
		importPlans.length > 0 ||
		exportPlans.length > 0 ||
		effectEitherPlans.length > 0 ||
		variantMemberPlans.length > 0 ||
		destructuringPlans.length > 0 ||
		objectFieldPlans.length > 0 ||
		tagPlans.size > 0;

	const dedupeImports = () => {
		const groups = new Map();
		for (const declarationPath of root.find(j.ImportDeclaration).paths()) {
			if (!EFFECT_SOURCES.has(declarationPath.node.source.value)) {
				continue;
			}
			for (const specifier of declarationPath.node.specifiers ?? []) {
				if (specifier.type !== "ImportSpecifier" || getNodeName(specifier.imported) !== "Result") {
					continue;
				}
				const key = [
					declarationPath.node.source.value,
					getImportKind(declarationPath.node, specifier),
					getNodeName(specifier.local),
				].join("\0");
				const entries = groups.get(key) ?? [];
				entries.push({ declarationPath, specifier });
				groups.set(key, entries);
			}
		}
		for (const entries of groups.values()) {
			if (entries.length < 2) {
				continue;
			}
			const survivor =
				entries.find((entry) => existingResultImports.has(entry.specifier)) ?? entries[0];
			for (const entry of entries) {
				if (entry === survivor) {
					continue;
				}
				copyComments(entry.specifier, survivor.specifier);
				if (entry.declarationPath.node !== survivor.declarationPath.node) {
					copyComments(entry.declarationPath.node, survivor.declarationPath.node);
				}
				entry.declarationPath.node.specifiers = entry.declarationPath.node.specifiers.filter(
					(specifier) => specifier !== entry.specifier,
				);
			}
		}
		root
			.find(j.ImportDeclaration)
			.filter(
				(path) => EFFECT_SOURCES.has(path.node.source.value) && path.node.specifiers?.length === 0,
			)
			.remove();
	};

	const dedupeExports = () => {
		const groups = new Map();
		for (const declarationPath of root.find(j.ExportNamedDeclaration).paths()) {
			if (!EFFECT_SOURCES.has(declarationPath.node.source?.value)) {
				continue;
			}
			for (const specifier of declarationPath.node.specifiers ?? []) {
				if (specifier.type !== "ExportSpecifier" || getNodeName(specifier.local) !== "Result") {
					continue;
				}
				const key = [
					declarationPath.node.source.value,
					getExportKind(declarationPath.node, specifier),
					getNodeName(specifier.exported),
				].join("\0");
				const entries = groups.get(key) ?? [];
				entries.push({ declarationPath, specifier });
				groups.set(key, entries);
			}
		}
		for (const entries of groups.values()) {
			if (entries.length < 2) {
				continue;
			}
			const survivor =
				entries.find((entry) => existingResultExports.has(entry.specifier)) ?? entries[0];
			for (const entry of entries) {
				if (entry === survivor) {
					continue;
				}
				copyComments(entry.specifier, survivor.specifier);
				if (entry.declarationPath.node !== survivor.declarationPath.node) {
					copyComments(entry.declarationPath.node, survivor.declarationPath.node);
				}
				entry.declarationPath.node.specifiers = entry.declarationPath.node.specifiers.filter(
					(specifier) => specifier !== entry.specifier,
				);
			}
		}
		root
			.find(j.ExportNamedDeclaration)
			.filter(
				(path) =>
					EFFECT_SOURCES.has(path.node.source?.value) &&
					!path.node.declaration &&
					path.node.specifiers?.length === 0,
			)
			.remove();
	};

	const dedupeLocalExports = () => {
		const touched = new Set();
		for (const entries of localExportDedupePlans) {
			const survivor = entries[0];
			for (const entry of entries) {
				if (entry === survivor) {
					continue;
				}
				copyComments(entry.specifier, survivor.specifier);
				if (entry.declarationPath.node !== survivor.declarationPath.node) {
					copyComments(entry.declarationPath.node, survivor.declarationPath.node);
				}
				entry.declarationPath.node.specifiers = entry.declarationPath.node.specifiers.filter(
					(specifier) => specifier !== entry.specifier,
				);
				touched.add(entry.declarationPath.node);
			}
		}
		root
			.find(j.ExportNamedDeclaration)
			.filter(
				(path) =>
					touched.has(path.node) &&
					!path.node.source &&
					!path.node.declaration &&
					path.node.specifiers?.length === 0,
			)
			.remove();
	};

	const apply = () => {
		for (const plan of importPlans) {
			setNodeName(plan.specifier.imported, "Result");
			if (plan.local !== "Either") {
				continue;
			}
			plan.specifier.local.name = "Result";
			for (const reference of plan.references) {
				reference.node.name = "Result";
				const parent = reference.parent?.node;
				if (
					parent?.type === "ExportSpecifier" &&
					parent.local === reference.node &&
					getNodeName(parent.exported) === "Either"
				) {
					setNodeName(parent.exported, "Result");
				}
			}
		}
		for (const plan of exportPlans) {
			setNodeName(plan.specifier.local, "Result");
			if (plan.exported === "Either") {
				setNodeName(plan.specifier.exported, "Result");
			}
		}
		for (const [node, info] of eitherMembers) {
			if (node.type === "TSQualifiedName") {
				node.right.name = info.rename;
			} else {
				node.property.name = info.rename;
			}
		}
		for (const plan of effectEitherPlans) {
			plan.path.node.property.name = "result";
		}
		for (const memberPath of variantMemberPlans) {
			memberPath.node.property.name = VARIANT_FIELD_RENAMES.get(memberPath.node.property.name);
		}
		for (const propertyPath of destructuringPlans) {
			renameProperty(
				j,
				propertyPath.node,
				VARIANT_FIELD_RENAMES.get(getPropertyName(propertyPath.node)),
			);
		}
		for (const property of objectFieldPlans) {
			renameProperty(j, property, VARIANT_FIELD_RENAMES.get(getPropertyName(property)));
		}
		for (const literal of tagPlans) {
			setStringValue(literal, TAG_RENAMES.get(literal.value));
		}
		dedupeImports();
		dedupeExports();
		dedupeLocalExports();
	};

	return { apply, changed, failure };
};

export default function result(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[result] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const plan = buildProgramPlan(root, j);

	if (plan.failure) {
		api.report(`[result] warning: skipped ${repositoryPath}: ${plan.failure}`);
		return file.source;
	}
	if (!plan.changed) {
		return;
	}

	plan.apply();
	api.report(`[result] transformed ${repositoryPath}`);
	return root.toSource();
}
