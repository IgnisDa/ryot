import { useRyot } from "@ryot-app/client-sdk/react";
import type { SchemaFileUpload } from "@ryot-app/client-ui-sdk/schema-form";

const UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

export const useSchemaFileUpload = (): SchemaFileUpload => {
	const ryot = useRyot();
	return async (request) => {
		try {
			const uploaded = await ryot.uploads.uploadTemporary(request);
			return { kind: "uploaded", token: uploaded.token };
		} catch {
			return { kind: "failed", message: UPLOAD_FAILURE_MESSAGE };
		}
	};
};
