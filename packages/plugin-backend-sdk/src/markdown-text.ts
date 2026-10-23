export const escapeMarkdownText = (input: string): string =>
	input
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line, index, lines) => {
			if (line.length === 0) {
				return "";
			}
			const escaped = line
				.replace(/[!-/:-@[-`{-~]/g, "\\$&")
				.replace(/^[ \t]+|[ \t]+$/g, (spaces) =>
					spaces.replace(/ /g, "&#32;").replace(/\t/g, "&#9;"),
				);
			return index < lines.length - 1 && lines[index + 1] !== "" ? `${escaped}\\` : escaped;
		})
		.join("\n");
