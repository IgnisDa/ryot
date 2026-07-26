import type { UploadSourceInput } from "./upload-source";

export const putUploadSource = async (input: UploadSourceInput) => {
	if (!(input.source instanceof Blob)) {
		throw new Error("The selected file is not backed by a browser File");
	}
	const fetch = input.fetch;
	const response = await fetch(input.url, {
		body: input.source,
		method: input.method,
		headers: { ...input.headers },
	});
	if (!response.ok) {
		throw new Error(`Upload target responded with ${response.status}`);
	}
};
