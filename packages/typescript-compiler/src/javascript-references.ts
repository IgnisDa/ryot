import type { Node } from "@oxc-project/types";
import { parseAst } from "rolldown/parseAst";

const isAstNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const literalString = (node: Node): string | undefined => {
	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	if (node.type !== "TemplateLiteral" || node.expressions.length > 0) {
		return undefined;
	}
	return node.quasis[0]?.value.cooked ?? undefined;
};

const isImportMetaUrl = (node: Node) =>
	node.type === "MemberExpression" &&
	!node.computed &&
	node.object.type === "MetaProperty" &&
	node.object.meta.name === "import" &&
	node.object.property.name === "meta" &&
	node.property.type === "Identifier" &&
	node.property.name === "url";

export const inspectJavaScriptReferences = (
	javascript: string,
	visitNode?: (node: Node) => void,
) => {
	const program = parseAst(javascript, { lang: "js" }, "emitted-output.mjs");
	const imports: string[] = [];
	const assets: string[] = [];
	const dynamicExpressions: string[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item);
			}
			return;
		}
		if (!isAstNode(value)) {
			return;
		}
		const node = value;
		if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
			imports.push(node.source.value);
		} else if (node.type === "ExportNamedDeclaration" && node.source !== null) {
			imports.push(node.source.value);
		} else if (node.type === "ImportExpression") {
			const specifier = literalString(node.source);
			if (specifier === undefined) {
				dynamicExpressions.push(javascript.slice(node.source.start, node.source.end));
			} else {
				imports.push(specifier);
			}
		} else if (
			node.type === "NewExpression" &&
			node.callee.type === "Identifier" &&
			node.callee.name === "URL" &&
			node.arguments[1] &&
			isImportMetaUrl(node.arguments[1]) &&
			node.arguments[0]
		) {
			const asset = literalString(node.arguments[0]);
			if (asset !== undefined) {
				assets.push(asset);
			}
		}
		visitNode?.(node);
		for (const [key, child] of Object.entries(node)) {
			if (key !== "parent") {
				visit(child);
			}
		}
	};
	visit(program);
	return { assets, imports, dynamicExpressions };
};
