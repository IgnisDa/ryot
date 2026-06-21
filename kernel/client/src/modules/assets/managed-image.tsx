import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { ImageIcon } from "lucide-react";
import { useState } from "react";

import { resolveAssetUrl } from "#/modules/assets/managed-assets";

type ManagedImageProps = {
	readonly asset: AssetLocator | null;
	readonly className: string;
	readonly urls: ReadonlyMap<string, string>;
};

export function ManagedImage(props: ManagedImageProps) {
	const url = props.asset === null ? undefined : resolveAssetUrl(props.asset, props.urls);
	if (url === undefined) {
		return <MissingImage className={props.className} />;
	}
	return <ResolvedImage key={url} url={url} className={props.className} />;
}

function ResolvedImage(props: { readonly url: string; readonly className: string }) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <MissingImage className={props.className} />;
	}
	return (
		<img
			alt=""
			loading="lazy"
			src={props.url}
			className={props.className}
			onError={() => setFailed(true)}
		/>
	);
}

function MissingImage(props: { readonly className: string }) {
	return (
		<div aria-hidden="true" className={`${props.className} grid place-items-center bg-raised`}>
			<ImageIcon className="size-5 text-text-subtle" />
		</div>
	);
}
