import { useRyot } from "@ryot-app/client-sdk/react";
import type { SchemaFileUpload } from "@ryot-app/client-ui-sdk/schema-form";
import { Effect } from "effect";

const UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

export const useSchemaFileUpload = (): SchemaFileUpload => {
	const ryot = useRyot();
	return (request) =>
		Effect.runPromise(
			ryot.uploads.uploadTemporary(request).pipe(
				Effect.map((uploaded) => ({ kind: "uploaded", token: uploaded.token }) as const),
				Effect.catch(() =>
					Effect.succeed({ kind: "failed", message: UPLOAD_FAILURE_MESSAGE } as const),
				),
			),
		);
};
