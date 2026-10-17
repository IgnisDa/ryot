import * as ts from "typescript/unstable/ast";

type Reference<Kind extends string, Node extends ts.Node> = {
	readonly kind: Kind;
	readonly node: Node;
	readonly specifier: string | null;
	readonly isTopLevel: boolean;
};

export type TypeScriptReference =
	| Reference<"import-declaration", ts.ImportDeclaration>
	| Reference<"export-declaration", ts.ExportDeclaration>
	| Reference<"import-equals-require", ts.ImportEqualsDeclaration>
	| Reference<"import-equals-alias", ts.ImportEqualsDeclaration>
	| Reference<"import-type", ts.ImportTypeNode>
	| Reference<"dynamic-import", ts.CallExpression>
	| Reference<"import-meta", ts.MetaProperty | ts.NewExpression>;

const literalText = (node: ts.Node | undefined) =>
	node && ts.isStringLiteralLikeNode(node) ? node.text : null;

const isImportMeta = (node: ts.Node): node is ts.MetaProperty =>
	ts.isMetaProperty(node) &&
	node.keywordToken === ts.SyntaxKind.ImportKeyword &&
	node.name.text === "meta";

const importMetaUrlBase = (node: ts.NewExpression) => {
	const base = node.arguments?.[1];
	return ts.isIdentifier(node.expression) &&
		node.expression.text === "URL" &&
		base &&
		ts.isPropertyAccessExpression(base) &&
		base.name.text === "url" &&
		isImportMeta(base.expression)
		? base.expression
		: null;
};

const isImportMetaUrlBase = (node: ts.MetaProperty) => {
	const site = node.parent.parent;
	return ts.isNewExpression(site) && importMetaUrlBase(site) === node;
};

const reference = (node: ts.Node): TypeScriptReference | null => {
	const isTopLevel = ts.isSourceFile(node.parent);
	if (ts.isImportDeclaration(node)) {
		return {
			node,
			isTopLevel,
			kind: "import-declaration",
			specifier: literalText(node.moduleSpecifier),
		};
	}
	if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
		return {
			node,
			isTopLevel,
			kind: "export-declaration",
			specifier: literalText(node.moduleSpecifier),
		};
	}
	if (ts.isImportEqualsDeclaration(node)) {
		return ts.isExternalModuleReference(node.moduleReference)
			? {
					node,
					isTopLevel,
					kind: "import-equals-require",
					specifier: literalText(node.moduleReference.expression),
				}
			: { node, isTopLevel, specifier: null, kind: "import-equals-alias" };
	}
	if (ts.isImportTypeNode(node)) {
		return {
			node,
			isTopLevel,
			kind: "import-type",
			specifier: ts.isLiteralTypeNode(node.argument) ? literalText(node.argument.literal) : null,
		};
	}
	if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
		return {
			node,
			isTopLevel,
			kind: "dynamic-import",
			specifier: literalText(node.arguments[0]),
		};
	}
	if (ts.isNewExpression(node) && importMetaUrlBase(node)) {
		return {
			node,
			isTopLevel,
			kind: "import-meta",
			specifier: literalText(node.arguments?.[0]),
		};
	}
	if (isImportMeta(node) && !isImportMetaUrlBase(node)) {
		return { node, isTopLevel, specifier: null, kind: "import-meta" };
	}
	return null;
};

export const inspectTypeScriptReferences = (file: ts.SourceFile) => {
	const references: TypeScriptReference[] = [];
	const visit = (node: ts.Node): void => {
		const found = reference(node);
		if (found) {
			references.push(found);
		}
		node.forEachChild(visit);
	};
	file.forEachChild(visit);
	return references;
};
