import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import type { SchemaFileUpload } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";

export const useSchemaFileUpload = (): SchemaFileUpload => {
	const t = useT();
	const ryot = useRyot();
	return (request) =>
		Effect.runPromise(
			ryot.uploads.uploadTemporary(request).pipe(
				Effect.map((uploaded) => ({ kind: "uploaded", token: uploaded.token }) as const),
				Effect.orElseSucceed(
					() =>
						({
							kind: "failed",
							message: t(kernelMessage("client.ui.schema-form-upload.failed")),
						}) as const,
				),
			),
		);
};
