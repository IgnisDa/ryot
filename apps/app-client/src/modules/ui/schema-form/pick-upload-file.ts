import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";

import { DEFAULT_UPLOAD_CONTENT_TYPE, type SchemaFilePicker } from "./file-upload";

export const pickUploadFile: SchemaFilePicker = async () => {
	const result = await getDocumentAsync({ base64: false, copyToCacheDirectory: true });
	const asset = result.canceled ? undefined : result.assets.at(0);
	if (asset === undefined) {
		return { kind: "canceled" };
	}
	const file = new File(asset.uri);
	return {
		kind: "picked",
		file: {
			name: asset.name,
			readBytes: () => file.bytes(),
			size: asset.size ?? file.size,
			contentType: asset.mimeType ?? DEFAULT_UPLOAD_CONTENT_TYPE,
		},
	};
};
