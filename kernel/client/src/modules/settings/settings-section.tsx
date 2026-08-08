import type { ReactNode } from "react";

type SettingsSectionProps = {
	readonly title: string;
	readonly detail: string;
	readonly children: ReactNode;
};

export function SettingsSection(props: SettingsSectionProps) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5 px-1">
				<h2 className="text-base font-semibold text-text">{props.title}</h2>
				<p className="text-sm text-text-muted">{props.detail}</p>
			</div>
			{props.children}
		</section>
	);
}
