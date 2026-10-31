import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { SchemaAssetUpload } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useState } from "react";

import { useRyot } from "../queries/provider";
import { ManagedAssetProvider, useAssetUrl } from "./provider";

export function AssetImage(props: { readonly asset: AssetLocator }) {
	const url = useAssetUrl(props.asset);
	const [video, setVideo] = useState(false);
	if (url === undefined) {
		return <span aria-hidden="true" className="block size-full bg-surface-2" />;
	}
	return video ? (
		<video muted src={url} preload="metadata" className="size-full object-cover" />
	) : (
		<img alt="" src={url} onError={() => setVideo(true)} className="size-full object-cover" />
	);
}

export const renderSchemaAsset = (asset: AssetLocator) => (
	<ManagedAssetProvider assets={asset.type === "remote" ? [] : [asset]}>
		<AssetImage asset={asset} />
	</ManagedAssetProvider>
);

export function useSchemaAssetUpload(): SchemaAssetUpload {
	const client = useRyot();
	return (request) =>
		Effect.runPromise(
			client.uploads
				.uploadPermanent(request)
				.pipe(
					Effect.match({
						onSuccess: (asset) => ({ asset, kind: "uploaded" as const }),
						onFailure: () => ({ kind: "failed" as const, message: "Upload failed. Try again." }),
					}),
				),
		);
}
