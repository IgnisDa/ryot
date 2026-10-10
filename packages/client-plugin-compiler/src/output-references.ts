import { parse } from "postcss";
import valueParser from "postcss-value-parser";

const url = (nodes: ReturnType<typeof valueParser>["nodes"]) => {
	const first = nodes.find((node) => node.type !== "space" && node.type !== "comment");
	return first?.type === "word" || first?.type === "string" ? first.value : undefined;
};

export const cssOutputReferences = (contents: string, name: string) => {
	const references: Array<{ readonly kind: "css" | "css-import"; readonly reference: string }> = [];
	const css = parse(contents, { from: name });
	css.walkAtRules("import", (rule) => {
		const first = valueParser(rule.params).nodes.find(
			(node) => node.type !== "space" && node.type !== "comment",
		);
		let reference: string | undefined;
		if (first?.type === "function" && first.value.toLowerCase() === "url") {
			reference = url(first.nodes);
		} else if (first?.type === "word" || first?.type === "string") {
			reference = first.value;
		}
		if (reference !== undefined) {
			references.push({ reference, kind: "css-import" });
		}
	});
	css.walkDecls((declaration) => {
		valueParser(declaration.value).walk((node) => {
			if (node.type === "function" && node.value.toLowerCase() === "url") {
				const reference = url(node.nodes);
				if (reference !== undefined) {
					references.push({ reference, kind: "css" });
				}
				return false;
			}
			return undefined;
		});
	});
	return references;
};
