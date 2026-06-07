import { getDocumentAsync } from "expo-document-picker";

import { pickBrowserUploadFile } from "./browser-file";
import type { SchemaFilePicker } from "./file-upload";

export const pickUploadFile: SchemaFilePicker = (options) =>
	pickBrowserUploadFile(options, getDocumentAsync);
