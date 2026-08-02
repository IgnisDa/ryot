import {
	DEFAULT_UPLOAD_CONTENT_TYPE,
	fileAcceptAttribute,
	type SchemaFileCandidate,
	type SchemaFilePicker,
} from "./file-upload";

type BrowserDocumentPickerAsset = {
	readonly file?: File;
	readonly name?: string;
};

type BrowserDocumentPickerResult =
	| { readonly canceled: true }
	| { readonly canceled: false; readonly assets: readonly BrowserDocumentPickerAsset[] };

type PickBrowserDocument = (options: {
	readonly type: string;
	readonly base64: false;
	readonly copyToCacheDirectory: false;
}) => Promise<BrowserDocumentPickerResult>;

export const browserFileCandidate = (file: File): SchemaFileCandidate => ({
	source: file,
	name: file.name,
	size: file.size,
	contentType: file.type === "" ? DEFAULT_UPLOAD_CONTENT_TYPE : file.type,
});

export const pickBrowserUploadFile = async (
	options: Parameters<SchemaFilePicker>[0],
	pickDocument: PickBrowserDocument,
) => {
	const result = await pickDocument({
		base64: false,
		copyToCacheDirectory: false,
		type: fileAcceptAttribute(options.allowedFileExtensions),
	});
	const file = result.canceled ? undefined : result.assets.at(0)?.file;
	return file === undefined
		? ({ kind: "canceled" } as const)
		: ({ kind: "picked", file: browserFileCandidate(file) } as const);
};
