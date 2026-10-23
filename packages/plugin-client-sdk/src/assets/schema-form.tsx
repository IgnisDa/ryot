import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { SchemaAssetUpload } from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { useRyot, useRyotSchedule } from "../queries/provider";
import { managedAssetKey } from "./keys";
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
	const schedule = useRyotSchedule();
	const mounted = useRef(false);
	const [uploaded] = useState(
		() => new Map<string, Effect.Success<ReturnType<typeof client.uploads.uploadPermanent>>>(),
	);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			schedule.run(
				Effect.forEach(
					[...uploaded.values()],
					(asset) => Effect.ignore(client.uploads.cleanup(asset)),
					{ discard: true },
				),
				() => undefined,
			);
		};
	}, [client, schedule, uploaded]);
	return (request) =>
		Effect.runPromise(
			client.uploads.uploadPermanent(request).pipe(
				Effect.matchEffect({
					onFailure: () =>
						Effect.succeed({ kind: "failed" as const, message: "Upload failed. Try again." }),
					onSuccess: (asset) =>
						Effect.gen(function* () {
							if (mounted.current) {
								uploaded.set(managedAssetKey(asset), asset);
							} else {
								yield* Effect.ignore(client.uploads.cleanup(asset));
							}
							return { asset, kind: "uploaded" as const };
						}),
				}),
			),
		);
}
