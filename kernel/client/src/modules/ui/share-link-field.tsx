import { Button, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { type ReactNode, useState } from "react";

import { type ShareOrCopy, shareOrCopy, sharesNatively } from "#/modules/device/share";

const actionPresentation = (copied: boolean) => {
	if (sharesNatively) {
		return { icon: "share", label: "Share" };
	}
	return copied ? { icon: "check", label: "Copied" } : { icon: "copy", label: "Copy" };
};

export function ShareLinkField(props: {
	readonly url: string;
	readonly label: string;
	readonly title?: string;
	readonly share?: ShareOrCopy;
	readonly children?: ReactNode;
}) {
	const share = props.share ?? shareOrCopy;
	const [copiedUrl, setCopiedUrl] = useState<null | string>(null);
	const [failedUrl, setFailedUrl] = useState<null | string>(null);
	const action = actionPresentation(copiedUrl === props.url);
	const content =
		props.title === undefined ? { url: props.url } : { url: props.url, title: props.title };
	return (
		<div className="grid gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-0 flex-1 basis-40">
					<TextField readOnly value={props.url} density="compact" aria-label={props.label} />
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() =>
						void Effect.runPromise(
							share(content).pipe(
								Effect.tapError((failure) => Effect.logWarning("link share failed", failure.cause)),
								Effect.match({
									onFailure: () => setFailedUrl(sharesNatively ? null : props.url),
									onSuccess: (outcome) => {
										setFailedUrl(null);
										setCopiedUrl(outcome === "copied" ? props.url : null);
									},
								}),
							),
						)
					}
				>
					<AppIcon size={16} name={action.icon} />
					{action.label}
				</Button>
				{props.children}
			</div>
			{failedUrl === props.url ? (
				<p role="alert" className="text-xs text-danger">
					Could not copy the link. Try again.
				</p>
			) : null}
		</div>
	);
}
