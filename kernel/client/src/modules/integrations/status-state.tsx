import clsx from "clsx";
import type { ReactNode } from "react";

type StatusStateProps = {
	readonly title?: string;
	readonly detail?: string;
	readonly icon?: ReactNode;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly detailTone?: "default" | "danger";
};

export function StatusState(props: StatusStateProps) {
	return (
		<div className={clsx("flex flex-col items-center justify-center gap-3 px-6", props.className)}>
			{props.icon}
			{props.title === undefined ? null : (
				<p className="text-center text-base font-medium text-text">{props.title}</p>
			)}
			{props.detail === undefined ? null : (
				<p
					role={props.detailTone === "danger" ? "alert" : "status"}
					className={clsx(
						"max-w-xl text-center text-sm",
						props.detailTone === "danger" ? "text-danger" : "text-text-muted",
					)}
				>
					{props.detail}
				</p>
			)}
			{props.action}
		</div>
	);
}
