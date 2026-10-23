import clsx from "clsx";
import type { ComponentProps } from "react";

import { Button } from "./button";

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	pending: "text-text-muted",
} as const;

type StatusMessageProps = ComponentProps<"p"> & {
	readonly tone: keyof typeof toneClasses;
	readonly action?:
		| { readonly label: string; readonly disabled?: boolean; readonly onClick: () => void }
		| undefined;
};

export function StatusMessage({ tone, action, className, ...props }: StatusMessageProps) {
	const message = (
		<p
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
