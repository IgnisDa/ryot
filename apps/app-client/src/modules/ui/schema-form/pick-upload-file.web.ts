import { browserFileCandidate } from "./browser-file";
import { fileAcceptAttribute, type SchemaFilePicker } from "./file-upload";

export const pickUploadFile: SchemaFilePicker = (options) =>
	new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;
		input.accept = fileAcceptAttribute(options.allowedFileExtensions);
		const settle = (outcome: Parameters<typeof resolve>[0]) => {
			input.remove();
			resolve(outcome);
		};
		input.addEventListener("cancel", () => settle({ kind: "canceled" }));
		input.addEventListener("change", () => {
			const file = input.files?.item(0) ?? undefined;
			settle(
				file === undefined
					? { kind: "canceled" }
					: { kind: "picked", file: browserFileCandidate(file) },
			);
		});
		document.body.append(input);
		input.click();
	});
