import type { Text } from "@ryot-app/i18n/text";
import clsx from "clsx";
import type { ComponentProps } from "react";

import { Button } from "./button";
import { reportText, useReportBlock } from "./report";

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	pending: "text-text-muted",
} as const;

type StatusMessageProps = ComponentProps<"p"> & {
	readonly blocked?: boolean;
	readonly tone: keyof typeof toneClasses;
	readonly action?:
		undefined | { readonly label: Text; readonly disabled?: boolean; readonly onClick: () => void };
};

export function StatusMessage({
	tone,
	action,
	className,
	blocked = false,
	...props
}: StatusMessageProps) {
	const report = useReportBlock(
		() => ({ kind: "text", lines: [reportText(props.children)] }),
		blocked,
	);
	const message = (
		<p
			ref={report}
			role={tone === "error" ? "alert" : "status"}
			className={clsx(toneClasses[tone], className)}
			{...props}
		/>
	);
	if (action === undefined) {
		return message;
	}
	return (
		<div className="flex items-center gap-3">
			{message}
			<Button variant="link" onClick={action.onClick} disabled={action.disabled}>
				{action.label}
			</Button>
		</div>
	);
}
