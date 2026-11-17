import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { Text } from "@ryot-app/i18n/text";

export type SchemaAssetUploadOutcome =
	| { readonly message: Text; readonly kind: "failed" }
	| { readonly kind: "uploaded"; readonly asset: AssetLocator };

export type SchemaAssetUpload = (request: {
	readonly source: Blob;
	readonly fileName: string;
	readonly contentType: string;
}) => Promise<SchemaAssetUploadOutcome>;
