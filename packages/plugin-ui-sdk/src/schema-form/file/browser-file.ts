import {
	DEFAULT_UPLOAD_CONTENT_TYPE,
	fileAcceptAttribute,
	type SchemaFileCandidate,
	type SchemaFilePicker,
	type SchemaFilePickOutcome,
} from "./upload";

const CANCELED = { kind: "canceled" } as const;

export const browserFileCandidate = (file: File): SchemaFileCandidate => ({
	source: file,
	name: file.name,
	size: file.size,
	contentType: file.type === "" ? DEFAULT_UPLOAD_CONTENT_TYPE : file.type,
});

export const pickBrowserUploadFile: SchemaFilePicker = (options) =>
	// oxlint-disable-next-line effecttsgo/new-promise -- The browser file input reports selection and cancellation only through DOM events.
	new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = fileAcceptAttribute(options.allowedFileExtensions);
		input.style.display = "none";
		const settle = (outcome: SchemaFilePickOutcome) => {
			input.remove();
			resolve(outcome);
		};
		input.addEventListener("cancel", () => settle(CANCELED));
		input.addEventListener("change", () => {
			const file = input.files?.item(0) ?? null;
			settle(file === null ? CANCELED : { kind: "picked", file: browserFileCandidate(file) });
		});
		document.body.append(input);
		input.click();
	});
