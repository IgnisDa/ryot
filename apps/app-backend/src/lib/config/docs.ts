import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { FieldMeta, GroupMeta } from "./builder";

type Tree = GroupMeta;

const collectFields = (node: Tree, level: number, lines: string[]): void => {
	lines.push(`${"#".repeat(level)} ${node.description}\n`);

	const directFields: FieldMeta[] = [];
	const childGroups: Tree[] = [];

	for (const child of Object.values(node.children)) {
		if (child.kind === "field") {
			if (!child.hidden) {
				directFields.push(child);
			}
		} else {
			childGroups.push(child);
		}
	}

	if (directFields.length > 0) {
		lines.push(
			"| Variable | Description | Required | Default |",
			"|---|---|---|---|",
			...directFields.map(
				(f) =>
					`| \`${f.envKey}\` | ${f.description} | ${f.required ? "Yes" : "No"} | ${f.default !== undefined ? `\`${f.default}\`` : "—"} |`,
			),
			"",
		);
	}

	for (const child of childGroups) {
		collectFields(child, level + 1, lines);
	}
};

const buildContent = (trees: Tree[]): string => {
	const lines: string[] = [
		"# App Backend Configuration Reference\n",
		"> This file is auto-generated on dev server startup. Do not edit manually.\n",
	];
	for (const tree of trees) {
		collectFields(tree, 2, lines);
	}
	return lines.join("\n");
};

export const generateConfigDocs = (trees: Tree[], outputPath: string) =>
	FileSystem.FileSystem.pipe(
		Effect.flatMap((fs) => fs.writeFileString(outputPath, buildContent(trees))),
	);
