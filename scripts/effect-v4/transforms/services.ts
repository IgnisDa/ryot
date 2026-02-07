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

const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);
const GENERATED_FILES = new Set(["runner.generated.ts"]);
const REPOSITORY_ROOT = process.cwd();

const KNOWN_SERVICE_IDENTIFIERS = new Set([
	"AppConfig",
	"AuthService",
	"AutomationsRepository",
	"AutomationsService",
	"BridgeService",
	"CollectionsRepository",
	"CollectionsService",
	"DbService",
	"DefinitionRegistry",
	"DefinitionsRepository",
	"DefinitionsService",
	"EntitiesRepository",
	"EntitiesService",
	"EntityImportService",
	"EntitySchemasRepository",
	"EventSchemasRepository",
	"EventsRepository",
	"EventsService",
	"FirstPartyPluginBootstrap",
	"GodModeRepository",
	"GodModeService",
	"ImportRunArtifacts",
	"ImportRunFailuresService",
	"ImportSourceCatalog",
	"ImportsRepository",
	"ImportsService",
	"IntegrationProviderCatalog",
	"IntegrationsRepository",
	"IntegrationsService",
	"InterestReconciler",
	"InterestService",
	"LegacyBootstrapMigrateDrop",
	"MigrationsComplete",
	"NotificationDeliveryService",
	"NotificationSubscriptionsService",
	"NotificationsRepository",
	"NotificationsService",
	"OperationalGateService",
	"OperationsService",
	"PackageCacheManager",
	"PluginBootService",
	"PluginCronService",
	"PluginIngestionService",
	"PluginInvalidationSubscriber",
	"PluginLoader",
	"PluginRepository",
	"PluginRuntimeResolver",
	"PluginUserBootstrapDispatcher",
	"ProcessPool",
	"QueryEngineService",
	"RedisService",
	"RelationshipSchemasRepository",
	"RelationshipsRepository",
	"RelationshipsService",
	"RunnerFile",
	"S3Service",
	"SandboxCompiler",
	"SandboxExecutionService",
	"SandboxRepository",
	"SandboxService",
	"SandboxWorkflowReferenceRepository",
	"SavedViewsRepository",
	"SavedViewsService",
	"ScriptGarbageCollector",
	"ServerRun",
	"SignalEmissionService",
	"SignalSchemasRepository",
	"SignalSchemasService",
	"SignalsRepository",
	"SignalsService",
	"StreamRegistry",
	"TestSupportService",
	"TranslationsRepository",
	"TranslationsService",
	"UploadsService",
	"UserPreferencesService",
	"UserStateService",
]);

const KNOWN_TAG_IDENTIFIERS = new Set([
	"AddEntityToCollectionWorkflowOperations",
	"AdminAccess",
	"AuthUserBootstrap",
	"CurrentDb",
	"CurrentUser",
	"DbRunner",
	"EntityImportWorkflowOperations",
	"EntityPopulationTrigger",
	"EventCreateWorkflowOperations",
	"ImportWorkflowPinning",
	"IntegrationOperationScopeResolver",
	"IntegrationRunOperations",
	"KernelWorkflowReferences",
	"LifecycleDispatch",
	"SandboxHostImplementations",
	"SandboxPluginScriptResolver",
	"SignalDispatch",
	"SubscriptionExecutionWorkflowOperations",
	"TransactionRunner",
	"TranslateEntityWorkflowOperations",
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

const getBinding = (identifierPath, local) => {
	const scope = identifierPath.scope?.lookup(local);
	const bindings = scope?.getBindings()[local];
	if (!scope || bindings?.length !== 1) {
		return;
	}
	return bindings[0];
};

const isNamedMember = (node, object, property) =>
	node?.type === "MemberExpression" &&
	!node.computed &&
	node.object?.type === "Identifier" &&
	node.object.name === object &&
	node.property?.type === "Identifier" &&
	node.property.name === property;

const isStringLiteral = (node) =>
	(node?.type === "StringLiteral" || node?.type === "Literal") && typeof node.value === "string";

const getTypeParameters = (node) => (node.typeParameters ?? node.typeArguments)?.params ?? [];

const isSelfType = (node, name) =>
	node?.type === "TSTypeReference" &&
	node.typeName?.type === "Identifier" &&
	node.typeName.name === name;

const getClassMemberName = (member) => {
	if (!member.computed && member.key?.type === "Identifier") {
		return member.key.name;
	}
	if (!member.computed && isStringLiteral(member.key)) {
		return member.key.value;
	}
};

const validateClass = (classNode, kind, fail) => {
	if (!classNode.id?.name) {
		fail(`unsupported anonymous ${kind} class`);
		return;
	}
	if (
		classNode.abstract ||
		classNode.declare ||
		classNode.decorators?.length ||
		classNode.typeParameters ||
		classNode.implements?.length ||
		classNode.superTypeParameters ||
		classNode.superTypeArguments
	) {
		fail(`unsupported ${kind} class shape ${classNode.id.name}`);
		return;
	}

	const collision = classNode.body.body.find(
		(member) => member.static && ["layer", "make"].includes(getClassMemberName(member)),
	);
	if (collision) {
		fail(`static ${getClassMemberName(collision)} collision in ${classNode.id.name}`);
		return;
	}
	if (classNode.body.body.length) {
		fail(`unsupported ${kind} class body ${classNode.id.name}`);
	}
};

const validateRootBinding = (memberPath, imported, fail) => {
	const identifierPath = memberPath.get("object");
	const binding = getBinding(identifierPath, identifierPath.node.name);
	const declaration = binding && getAncestorPath(binding, "ImportDeclaration")?.node;
	const specifier = binding?.parent?.node;
	if (
		!declaration ||
		declaration.source.value !== "effect" ||
		specifier?.type !== "ImportSpecifier" ||
		getImportedName(specifier) !== imported ||
		specifier.local?.name !== identifierPath.node.name ||
		getImportKind(declaration, specifier) !== "value"
	) {
		fail(`unsupported ${identifierPath.node.name} binding`);
	}
};

const validateService = (memberPath, fail) => {
	const classPath = getAncestorPath(memberPath, "ClassDeclaration");
	const classNode = classPath?.node;
	const inner = memberPath.parent?.node;
	const outer = memberPath.parent?.parent?.node;
	if (
		!classNode ||
		inner?.type !== "CallExpression" ||
		inner.callee !== memberPath.node ||
		inner.arguments.length !== 0 ||
		outer?.type !== "CallExpression" ||
		outer.callee !== inner ||
		classNode.superClass !== outer
	) {
		fail("unsupported Effect.Service declaration");
		return;
	}

	validateClass(classNode, "Effect.Service", fail);
	if (!classNode.id?.name) {
		return;
	}

	const typeParameters = getTypeParameters(inner);
	const [key, options] = outer.arguments;
	if (
		typeParameters.length !== 1 ||
		!isSelfType(typeParameters[0], classNode.id.name) ||
		outer.arguments.length !== 2 ||
		!isStringLiteral(key) ||
		key.value !== classNode.id.name ||
		options?.type !== "ObjectExpression" ||
		getTypeParameters(outer).length
	) {
		fail(`unsupported Effect.Service call ${classNode.id.name}`);
		return;
	}

	const properties = [];
	for (const property of options.properties) {
		if (
			property.type !== "ObjectProperty" ||
			property.computed ||
			property.method ||
			property.shorthand ||
			property.key?.type !== "Identifier" ||
			!["dependencies", "effect", "scoped", "sync"].includes(property.key.name)
		) {
			fail(`unsupported service option in ${classNode.id.name}`);
			continue;
		}
		properties.push(property);
	}

	const makeProperties = properties.filter((property) =>
		["effect", "scoped", "sync"].includes(property.key.name),
	);
	const dependencyProperties = properties.filter(
		(property) => property.key.name === "dependencies",
	);
	if (
		properties.length !== options.properties.length ||
		makeProperties.length !== 1 ||
		dependencyProperties.length > 1
	) {
		fail(`unsupported service options ${classNode.id.name}`);
		return;
	}

	const makeProperty = makeProperties[0];
	if (
		makeProperty.key.name === "sync" &&
		!["ArrowFunctionExpression", "FunctionExpression", "Identifier"].includes(
			makeProperty.value.type,
		)
	) {
		fail(`unsupported sync constructor ${classNode.id.name}`);
		return;
	}

	const dependenciesProperty = dependencyProperties[0];
	const dependencies = dependenciesProperty?.value;
	if (
		dependenciesProperty &&
		(dependencies.type !== "ArrayExpression" ||
			!dependencies.elements.length ||
			dependencies.elements.some((element) => !element || element.type === "SpreadElement"))
	) {
		fail(`unsupported dependencies ${classNode.id.name}`);
		return;
	}

	validateRootBinding(memberPath, "Effect", fail);
	return {
		classNode,
		dependencies,
		dependenciesProperty,
		inner,
		makeProperty,
		member: memberPath.node,
		options,
	};
};

const validateTag = (memberPath, fail) => {
	const classPath = getAncestorPath(memberPath, "ClassDeclaration");
	const classNode = classPath?.node;
	const inner = memberPath.parent?.node;
	const outer = memberPath.parent?.parent?.node;
	if (
		!classNode ||
		inner?.type !== "CallExpression" ||
		inner.callee !== memberPath.node ||
		outer?.type !== "CallExpression" ||
		outer.callee !== inner ||
		classNode.superClass !== outer
	) {
		fail("unsupported Context.Tag declaration");
		return;
	}

	validateClass(classNode, "Context.Tag", fail);
	if (!classNode.id?.name) {
		return;
	}

	const typeParameters = getTypeParameters(outer);
	const [key] = inner.arguments;
	if (
		inner.arguments.length !== 1 ||
		!isStringLiteral(key) ||
		key.value !== classNode.id.name ||
		getTypeParameters(inner).length ||
		outer.arguments.length ||
		typeParameters.length !== 2 ||
		!isSelfType(typeParameters[0], classNode.id.name)
	) {
		fail(`unsupported Context.Tag call ${classNode.id.name}`);
		return;
	}

	validateRootBinding(memberPath, "Context", fail);
	return { classNode, inner, key, member: memberPath.node, outer };
};

const isContextServiceClass = (classNode) => {
	const outer = classNode.superClass;
	const inner = outer?.callee;
	return (
		outer?.type === "CallExpression" &&
		inner?.type === "CallExpression" &&
		inner.arguments.length === 0 &&
		isNamedMember(inner.callee, "Context", "Service") &&
		isSelfType(getTypeParameters(inner)[0], classNode.id?.name)
	);
};

const isKnownServiceReference = (identifierPath, serviceClassNodes) => {
	const binding = getBinding(identifierPath, identifierPath.node.name);
	if (!binding) {
		return false;
	}

	const declaration = getAncestorPath(binding, "ImportDeclaration")?.node;
	const specifier = binding.parent?.node;
	if (
		declaration &&
		specifier?.type === "ImportSpecifier" &&
		KNOWN_SERVICE_IDENTIFIERS.has(getImportedName(specifier)) &&
		getImportKind(declaration, specifier) === "value"
	) {
		return true;
	}

	const classNode = getAncestorPath(binding, "ClassDeclaration")?.node;
	return Boolean(
		classNode?.id === binding.node &&
		KNOWN_SERVICE_IDENTIFIERS.has(classNode.id.name) &&
		(serviceClassNodes.has(classNode) || isContextServiceClass(classNode)),
	);
};

const TYPE_DECLARATION_TYPES = new Set([
	"ClassDeclaration",
	"TSEnumDeclaration",
	"TSInterfaceDeclaration",
	"TSModuleDeclaration",
	"TSTypeAliasDeclaration",
]);

const hasTypeShadow = (identifierPath, classNodes, knownIdentifiers) => {
	const name = identifierPath.node.name;
	for (let parent = identifierPath.parent; parent; parent = parent.parent) {
		if (
			getTypeParameters(parent.node).some(
				(parameter) => parameter.type === "TSTypeParameter" && parameter.name === name,
			)
		) {
			return true;
		}
		if (parent.node?.type === "TSMappedType" && parent.node.typeParameter?.name === name) {
			return true;
		}
		if (Array.isArray(parent.node?.body)) {
			for (const statement of parent.node.body) {
				const declaration = statement.declaration ?? statement;
				if (
					TYPE_DECLARATION_TYPES.has(declaration.type) &&
					declaration.id?.name === name &&
					!(
						declaration.type === "ClassDeclaration" &&
						knownIdentifiers.has(name) &&
						(classNodes.has(declaration) || isContextServiceClass(declaration))
					)
				) {
					return true;
				}
			}
		}
	}
	return false;
};

const isKnownTagReference = (identifierPath, tagClassNodes) => {
	if (hasTypeShadow(identifierPath, tagClassNodes, KNOWN_TAG_IDENTIFIERS)) {
		return false;
	}
	const binding = getBinding(identifierPath, identifierPath.node.name);
	if (!binding) {
		return false;
	}

	const declaration = getAncestorPath(binding, "ImportDeclaration")?.node;
	const specifier = binding.parent?.node;
	if (
		declaration &&
		specifier?.type === "ImportSpecifier" &&
		KNOWN_TAG_IDENTIFIERS.has(getImportedName(specifier))
	) {
		return true;
	}

	const classNode = getAncestorPath(binding, "ClassDeclaration")?.node;
	return Boolean(
		classNode?.id === binding.node &&
		KNOWN_TAG_IDENTIFIERS.has(classNode.id.name) &&
		(tagClassNodes.has(classNode) || isContextServiceClass(classNode)),
	);
};

const isKnownServiceTypeReference = (identifierPath, serviceClassNodes) => {
	if (hasTypeShadow(identifierPath, serviceClassNodes, KNOWN_SERVICE_IDENTIFIERS)) {
		return false;
	}
	const binding = getBinding(identifierPath, identifierPath.node.name);
	if (!binding) {
		return false;
	}

	const declaration = getAncestorPath(binding, "ImportDeclaration")?.node;
	const specifier = binding.parent?.node;
	if (
		declaration &&
		specifier?.type === "ImportSpecifier" &&
		KNOWN_SERVICE_IDENTIFIERS.has(getImportedName(specifier))
	) {
		return true;
	}

	const classNode = getAncestorPath(binding, "ClassDeclaration")?.node;
	return Boolean(
		classNode?.id === binding.node &&
		KNOWN_SERVICE_IDENTIFIERS.has(classNode.id.name) &&
		(serviceClassNodes.has(classNode) || isContextServiceClass(classNode)),
	);
};

const getQualifiedTypeName = (node) => {
	if (
		node?.type === "TSQualifiedName" &&
		node.left?.type === "Identifier" &&
		node.right?.type === "Identifier"
	) {
		return `${node.left.name}.${node.right.name}`;
	}
};

const getContainingTypeParameter = (path, node) => {
	const parameters = getTypeParameters(node);
	for (let parent = path; parent && parent.node !== node; parent = parent.parent) {
		const index = parameters.indexOf(parent.node);
		if (index >= 0) {
			return index;
		}
	}
	return -1;
};

const getContextMember = (callee) => {
	const member = callee?.type === "CallExpression" ? callee.callee : callee;
	if (
		member?.type === "MemberExpression" &&
		!member.computed &&
		member.object?.type === "Identifier" &&
		member.object.name === "Context" &&
		member.property?.type === "Identifier"
	) {
		return member.property.name;
	}
};

const isServiceEnvironmentType = (path) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (
			parent.node?.type === "CallExpression" &&
			getContainingTypeParameter(path, parent.node) >= 0 &&
			["Reference", "Service", "Tag"].includes(getContextMember(parent.node.callee))
		) {
			return true;
		}
		if (parent.node?.type !== "TSTypeReference") {
			continue;
		}

		const index = getContainingTypeParameter(path, parent.node);
		if (index < 0) {
			continue;
		}
		const name = getQualifiedTypeName(parent.node.typeName);
		if (
			(name === "Effect.Effect" && index === 2) ||
			(name === "Layer.Layer" && (index === 0 || index === 2)) ||
			(name === "Runtime.Runtime" && index === 0) ||
			name?.startsWith("Context.")
		) {
			return true;
		}
	}
	return false;
};

const getTypeAliasBinding = (identifierPath) => {
	const name = identifierPath.node.name;
	for (let parent = identifierPath.parent; parent; parent = parent.parent) {
		if (
			getTypeParameters(parent.node).some(
				(parameter) => parameter.type === "TSTypeParameter" && parameter.name === name,
			) ||
			(parent.node?.type === "TSMappedType" && parent.node.typeParameter?.name === name)
		) {
			return;
		}
		if (!Array.isArray(parent.node?.body)) {
			continue;
		}

		const matches = [];
		for (let index = 0; index < parent.node.body.length; index += 1) {
			const statementPath = parent.get("body", index);
			const declarationPath = statementPath.node.declaration
				? statementPath.get("declaration")
				: statementPath;
			if (
				TYPE_DECLARATION_TYPES.has(declarationPath.node.type) &&
				declarationPath.node.id?.name === name
			) {
				matches.push(declarationPath);
			}
		}
		if (matches.length) {
			return matches.length === 1 && matches[0].node.type === "TSTypeAliasDeclaration"
				? matches[0]
				: undefined;
		}
	}
};

const isInsideTypeAlias = (path, aliases) => {
	for (let parent = path.parent; parent; parent = parent.parent) {
		if (parent.node?.type === "TSTypeAliasDeclaration") {
			return aliases.has(parent.node);
		}
	}
	return false;
};

const getIndexedTypeName = (path) => {
	const parent = path.parent?.node;
	if (parent?.type === "TSIndexedAccessType" && parent.objectType === path.node) {
		return parent.indexType?.type === "TSLiteralType" && isStringLiteral(parent.indexType.literal)
			? parent.indexType.literal.value
			: undefined;
	}
};

const isTypeProjection = (node) =>
	node?.type === "TSLiteralType" && isStringLiteral(node.literal) && node.literal.value === "Type";

const getProjectionIdentifierPath = (path) => {
	const objectPath = path.get("objectType");
	if (
		objectPath.node?.type !== "TSTypeReference" ||
		objectPath.node.typeName?.type !== "Identifier"
	) {
		return;
	}
	return objectPath.get("typeName");
};

const copyComments = (from, to) => {
	if (!from?.comments?.length) {
		return;
	}
	to.comments = [...from.comments, ...(to.comments ?? [])];
};

const getRequiredImportPlan = (root, j, name, sites, fail) => {
	const declarationPaths = root.find(j.ImportDeclaration, { source: { value: "effect" } }).paths();
	const exact = declarationPaths.flatMap((declarationPath) =>
		(declarationPath.node.specifiers ?? [])
			.map((specifier) => ({
				declarationPath,
				specifier,
			}))
			.filter(
				(item) =>
					item.specifier.type === "ImportSpecifier" &&
					getImportedName(item.specifier) === name &&
					item.specifier.local?.name === name,
			),
	);
	const bindingNodes = new Set(exact.map((item) => item.specifier.local));
	for (const site of sites) {
		const scope = site.scope?.lookup(name);
		const bindings = scope?.getBindings()[name] ?? [];
		if (bindings.some((binding) => !bindingNodes.has(binding.node))) {
			fail(`binding ${name} would collide`);
			return;
		}
	}

	const valueImport = exact.find(
		(item) => getImportKind(item.declarationPath.node, item.specifier) === "value",
	);
	if (valueImport) {
		return { action: "none", name };
	}

	const targetPath = declarationPaths.find(
		(path) =>
			path.node.importKind !== "type" &&
			!path.node.assertions?.length &&
			!path.node.attributes?.length &&
			!path.node.specifiers?.some((specifier) => specifier.type === "ImportNamespaceSpecifier"),
	);
	if (!targetPath) {
		fail(`cannot add value import ${name} from effect`);
		return;
	}

	const typeImport = exact[0];
	if (typeImport?.declarationPath === targetPath) {
		return { action: "promote", name, specifier: typeImport.specifier };
	}
	if (typeImport) {
		return { action: "move", name, targetPath, ...typeImport };
	}
	return { action: "add", name, targetPath };
};

const insertImportSpecifier = (declaration, specifier) => {
	const name = getImportedName(specifier);
	const index = declaration.specifiers.findIndex(
		(existing) =>
			existing.type === "ImportSpecifier" && getImportedName(existing).localeCompare(name) > 0,
	);
	if (index < 0) {
		declaration.specifiers.push(specifier);
	} else {
		declaration.specifiers.splice(index, 0, specifier);
	}
};

const applyImportPlan = (j, plan) => {
	if (plan.action === "none") {
		return;
	}
	if (plan.action === "promote") {
		plan.specifier.importKind = null;
		return;
	}

	const specifier =
		plan.action === "move" ? plan.specifier : j.importSpecifier(j.identifier(plan.name));
	if (plan.action === "move") {
		const index = plan.declarationPath.node.specifiers.indexOf(specifier);
		plan.declarationPath.node.specifiers.splice(index, 1);
		specifier.importKind = null;
	}
	insertImportSpecifier(plan.targetPath.node, specifier);

	if (plan.action === "move" && !plan.declarationPath.node.specifiers.length) {
		copyComments(plan.declarationPath.node, plan.targetPath.node);
		plan.declarationPath.prune();
	}
};

const makeLayerProperty = (j, plan) => {
	const layerEffect = j.callExpression(
		j.memberExpression(j.identifier("Layer"), j.identifier("effect")),
		[j.thisExpression(), j.memberExpression(j.thisExpression(), j.identifier("make"))],
	);
	let value = layerEffect;
	if (plan.dependencies) {
		let dependency =
			plan.dependencies.elements.length === 1
				? plan.dependencies.elements[0]
				: j.callExpression(
						j.memberExpression(j.identifier("Layer"), j.identifier("mergeAll")),
						plan.dependencies.elements,
					);
		copyComments(plan.dependencies, dependency);
		value = j.callExpression(j.memberExpression(layerEffect, j.identifier("pipe")), [
			j.callExpression(j.memberExpression(j.identifier("Layer"), j.identifier("provide")), [
				dependency,
			]),
		]);
	}

	const property = j.classProperty(j.identifier("layer"), value);
	property.static = true;
	property.readonly = true;
	copyComments(plan.dependenciesProperty, property);
	return property;
};

export default function services(file, api) {
	const repositoryPath = getRepositoryPath(file.path);
	if (!repositoryPath) {
		api.report(`[services] warning: skipped ${file.path}: outside lexical scope`);
		return;
	}

	const j = api.jscodeshift;
	const root = j(file.source);
	const serviceMemberPaths = root
		.find(j.MemberExpression)
		.paths()
		.filter((path) => isNamedMember(path.node, "Effect", "Service"));
	const tagMemberPaths = root
		.find(j.MemberExpression)
		.paths()
		.filter((path) => isNamedMember(path.node, "Context", "Tag"));
	let failure;
	const fail = (reason) => {
		failure ??= reason;
	};

	const servicePlans = serviceMemberPaths
		.map((path) => validateService(path, fail))
		.filter(Boolean);
	const tagPlans = tagMemberPaths.map((path) => validateTag(path, fail)).filter(Boolean);
	const serviceClassNodes = new Set(servicePlans.map((plan) => plan.classNode));
	const tagClassNodes = new Set(tagPlans.map((plan) => plan.classNode));
	const environmentAliasNodes = new Set();
	for (const path of root.find(j.TSTypeReference).paths()) {
		if (path.node.typeName?.type !== "Identifier" || !isServiceEnvironmentType(path)) {
			continue;
		}
		const aliasPath = getTypeAliasBinding(path.get("typeName"));
		if (aliasPath) {
			environmentAliasNodes.add(aliasPath.node);
		}
	}
	const serviceTypePaths = [];
	for (const path of root.find(j.TSTypeReference).paths()) {
		if (
			path.node.typeName?.type !== "Identifier" ||
			!isKnownServiceTypeReference(path.get("typeName"), serviceClassNodes)
		) {
			continue;
		}
		const indexedName = getIndexedTypeName(path);
		if (
			indexedName === "Service" ||
			isServiceEnvironmentType(path) ||
			isInsideTypeAlias(path, environmentAliasNodes)
		) {
			continue;
		}
		if (indexedName === "Type" || getTypeParameters(path.node).length) {
			fail(`unsupported migrated service type ${path.node.typeName.name}`);
			continue;
		}
		serviceTypePaths.push(path);
	}
	const environmentProjectionPaths = [];
	for (const path of root.find(j.TSIndexedAccessType).paths()) {
		if (
			!isInsideTypeAlias(path, environmentAliasNodes) ||
			(path.parent?.node?.type === "TSIndexedAccessType" &&
				path.parent.node.objectType === path.node) ||
			getIndexedTypeName(path.get("objectType")) !== "Service"
		) {
			continue;
		}
		const identifierPath = getProjectionIdentifierPath(path);
		if (identifierPath && isKnownServiceTypeReference(identifierPath, serviceClassNodes)) {
			environmentProjectionPaths.push(path);
		}
	}
	const referencePaths = root
		.find(j.MemberExpression)
		.paths()
		.filter(
			(path) =>
				!path.node.computed &&
				path.node.object?.type === "Identifier" &&
				path.node.property?.type === "Identifier" &&
				path.node.property.name === "Default" &&
				isKnownServiceReference(path.get("object"), serviceClassNodes),
		);
	const referenceNodes = new Set(referencePaths.map((path) => path.node));
	const tagProjectionPaths = [];
	for (const path of root.find(j.TSIndexedAccessType).paths()) {
		const identifierPath = getProjectionIdentifierPath(path);
		if (!identifierPath || !isKnownTagReference(identifierPath, tagClassNodes)) {
			continue;
		}
		if (isTypeProjection(path.node.indexType) && !getTypeParameters(path.node.objectType).length) {
			tagProjectionPaths.push(path);
		} else if (
			isTypeProjection(path.node.indexType) ||
			j(path.node.indexType).find(j.TSLiteralType).nodes().some(isTypeProjection)
		) {
			fail(`unsupported migrated tag projection ${identifierPath.node.name}`);
		}
	}
	for (const path of root.find(j.TSQualifiedName).paths()) {
		if (
			path.node.left?.type === "Identifier" &&
			path.node.right?.type === "Identifier" &&
			path.node.right.name === "Type" &&
			isKnownTagReference(path.get("left"), tagClassNodes)
		) {
			fail(`unsupported migrated tag projection ${path.node.left.name}`);
		}
	}
	for (const path of root.find(j.MemberExpression).paths()) {
		if (
			!path.node.computed &&
			path.node.object?.type === "Identifier" &&
			path.node.property?.type === "Identifier" &&
			path.node.property.name === "Type" &&
			isKnownTagReference(path.get("object"), tagClassNodes)
		) {
			fail(`unsupported migrated tag projection ${path.node.object.name}`);
		}
	}

	for (const plan of servicePlans) {
		for (const dependency of plan.dependencies?.elements ?? []) {
			if (
				!isNamedMember(dependency, dependency.object?.name, "layer") &&
				!referenceNodes.has(dependency)
			) {
				fail(`unsupported dependency in ${plan.classNode.id.name}`);
			}
		}
	}

	const required = new Map();
	if (servicePlans.length) {
		required.set(
			"Context",
			serviceMemberPaths.map((path) => path.get("object")),
		);
		required.set(
			"Layer",
			serviceMemberPaths.map((path) => path.get("object")),
		);
	}
	if (tagPlans.length) {
		required.set("Context", [
			...(required.get("Context") ?? []),
			...tagMemberPaths.map((path) => path.get("object")),
		]);
	}
	const importPlans = [...required].map(([name, sites]) =>
		getRequiredImportPlan(root, j, name, sites, fail),
	);

	if (failure) {
		api.report(`[services] warning: skipped ${repositoryPath}: ${failure}`);
		return file.source;
	}
	if (
		!servicePlans.length &&
		!tagPlans.length &&
		!referencePaths.length &&
		!tagProjectionPaths.length &&
		!serviceTypePaths.length &&
		!environmentProjectionPaths.length
	) {
		return;
	}

	for (const path of referencePaths) {
		path.node.property.name = "layer";
	}
	for (const path of tagProjectionPaths) {
		path.node.indexType.literal.value = "Service";
	}
	const functionTypePaths = new Map();
	for (const path of environmentProjectionPaths) {
		for (let parent = path.parent; parent; parent = parent.parent) {
			if (parent.node?.type === "TSFunctionType" || parent.node?.type === "TSConstructorType") {
				functionTypePaths.set(parent.node, parent);
			}
		}
		const replacement = path.node.objectType;
		copyComments(path.node, replacement);
		path.replace(replacement);
	}
	for (const path of serviceTypePaths) {
		for (let parent = path.parent; parent; parent = parent.parent) {
			if (parent.node?.type === "TSFunctionType" || parent.node?.type === "TSConstructorType") {
				functionTypePaths.set(parent.node, parent);
			}
		}
		path.replace(j.tsIndexedAccessType(path.node, j.tsLiteralType(j.stringLiteral("Service"))));
	}
	for (const [node, path] of functionTypePaths) {
		const replacement =
			node.type === "TSFunctionType"
				? j.tsFunctionType.from({
						typeParameters: node.typeParameters,
						parameters: node.parameters,
						typeAnnotation: node.typeAnnotation,
					})
				: j.tsConstructorType.from({
						typeParameters: node.typeParameters,
						parameters: node.parameters,
						typeAnnotation: node.typeAnnotation,
					});
		if (node.type === "TSConstructorType") {
			replacement.abstract = node.abstract;
		}
		copyComments(node, replacement);
		path.replace(replacement);
	}
	for (const plan of servicePlans) {
		const makeKind = plan.makeProperty.key.name;
		plan.member.object.name = "Context";
		plan.makeProperty.key.name = "make";
		if (makeKind === "sync") {
			plan.makeProperty.value = j.callExpression(
				j.memberExpression(j.identifier("Effect"), j.identifier("sync")),
				[plan.makeProperty.value],
			);
		}
		if (plan.dependenciesProperty) {
			plan.options.properties = plan.options.properties.filter(
				(property) => property !== plan.dependenciesProperty,
			);
		}
		plan.classNode.body.body.push(makeLayerProperty(j, plan));
	}
	for (const plan of tagPlans) {
		const typeParameters = plan.outer.typeParameters ?? plan.outer.typeArguments;
		plan.member.property.name = "Service";
		plan.inner.arguments = [];
		plan.inner.typeParameters = typeParameters;
		plan.inner.typeArguments = null;
		plan.outer.arguments = [plan.key];
		plan.outer.typeParameters = null;
		plan.outer.typeArguments = null;
	}
	for (const plan of importPlans) {
		applyImportPlan(j, plan);
	}

	const output = root.toSource();
	api.report(`[services] transformed ${repositoryPath}`);
	return output;
}
