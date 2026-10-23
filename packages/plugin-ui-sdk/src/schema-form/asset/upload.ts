import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";

export type SchemaAssetUploadOutcome =
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "uploaded"; readonly asset: AssetLocator };

export type SchemaAssetUpload = (request: {
	readonly fileName: string;
	readonly source: Blob;
	readonly contentType: string;
}) => Promise<SchemaAssetUploadOutcome>;
