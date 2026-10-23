import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState } from "react";

import { MediaLinkButton } from "../primitives";
import { MediaReviewForm } from "../review";
import { MediaActivityLogSheet } from "./sheet";
import type { MediaActivityLogger } from "./state";

export function MediaLogActivityButton(props: {
	readonly link?: boolean;
	readonly compact: boolean;
	readonly entityId: string;
	readonly logger: MediaActivityLogger;
}) {
	const [open, setOpen] = useState<"log" | "review" | undefined>(undefined);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			{props.link ? (
				<MediaLinkButton ref={triggerRef} label="Log activity" onClick={() => setOpen("log")} />
			) : (
				<Button ref={triggerRef} onClick={() => setOpen("log")}>
					<AppIcon size={15} name="plus" />
					Log activity
				</Button>
			)}
			{open === "log" ? (
				<MediaActivityLogSheet
					logger={props.logger}
					compact={props.compact}
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(undefined)}
					onReview={() => setOpen("review")}
				/>
			) : null}
			{open === "review" ? (
				<MediaReviewForm
					triggerRef={triggerRef}
					entityId={props.entityId}
					onClose={() => setOpen(undefined)}
				/>
			) : null}
		</>
	);
}
