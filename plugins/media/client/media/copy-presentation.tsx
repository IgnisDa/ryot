import { Badge } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

import { type MediaCopyProperties, mediaCopySpecification } from "../../shared/media-copy";
import { useMediaCopy } from "../messages";
import { formatDateOnlyLabel } from "./date";

export function MediaCopyVersion(props: {
	readonly actions?: ReactNode;
	readonly details: typeof MediaCopyProperties.Type;
}) {
	const { details } = props;
	const { text, local, formatters } = useMediaCopy();
	const scanSuffix = { interlaced: "i", progressive: "p" };
	const resolution =
		details.resolution === undefined
			? undefined
			: details.resolution + (details.scanType === undefined ? "" : scanSuffix[details.scanType]);
	const audio = [
		...[details.audioCodec, details.audioSpatialFormat].flatMap((value) =>
			value === undefined ? [] : [local(mediaCopySpecification(value))],
		),
		...(details.audioChannels === undefined ? [] : [details.audioChannels]),
	];
	return (
		<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
			<div className="grid min-w-0 gap-2">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
					<span className="text-sm font-semibold text-text">
						{details.format === undefined
							? text("ownership.unknown-format")
							: local(mediaCopySpecification(details.format))}
					</span>
					{resolution !== undefined && (
						<Badge size="sm" variant="accent">
							{resolution}
						</Badge>
					)}
					{details.hdr !== undefined && (
						<Badge size="sm" variant="neutral">
							{local(mediaCopySpecification(details.hdr))}
						</Badge>
					)}
					{details.is3d === true && (
						<Badge size="sm" variant="neutral">
							{text("ownership.video-3d")}
						</Badge>
					)}
					{details.origin === "integration" && (
						<Badge size="sm" variant="outline">
							{text("ownership.synced")}
						</Badge>
					)}
				</div>
				{audio.length > 0 && <p className="text-xs text-text-muted">{audio.join(" · ")}</p>}
				{details.acquiredOn !== undefined && (
					<p className="text-xs text-text-subtle">
						{text("property.owned-on")} {formatDateOnlyLabel(formatters, details.acquiredOn)}
					</p>
				)}
				{details.sourceAddedAt !== undefined && (
					<p className="text-xs text-text-subtle">
						{text("ownership.source-added")}{" "}
						{formatDateOnlyLabel(formatters, details.sourceAddedAt.slice(0, 10))}
					</p>
				)}
			</div>
			{props.actions}
		</div>
	);
}
