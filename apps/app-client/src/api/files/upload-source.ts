import type { File } from "expo-file-system";

export type UploadFileSource = Blob | File;

export type UploadSourceInput = {
	readonly url: string;
	readonly method: "PUT";
	readonly contentType: string;
	readonly source: UploadFileSource;
	readonly fetch: typeof globalThis.fetch;
	readonly headers: Readonly<Record<string, string>>;
};

type NativeUploadSource = UploadFileSource & Pick<File, "upload">;

const isNativeUploadSource = (source: UploadFileSource): source is NativeUploadSource =>
	"upload" in source && typeof source.upload === "function";

export const putUploadSource = async (input: UploadSourceInput) => {
	if (!isNativeUploadSource(input.source)) {
		throw new Error("The selected file is not backed by the native file system");
	}
	const response = await input.source.upload(input.url, {
		httpMethod: input.method,
		mimeType: input.contentType,
		headers: { ...input.headers },
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`Upload target responded with ${response.status}`);
	}
};
