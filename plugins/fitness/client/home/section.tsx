import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	type RyotQueryResult,
	type Text,
	usePluginIdentity,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import clsx from "clsx";
import type { ReactNode } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { cardClass, cardHeadingClass } from "../exercise/styles";
import { useFitnessMessages } from "../messages";

export const linkClass = "text-[13px] font-medium text-accent-text";

const actionLinkClass =
	"inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-semibold";

export const primaryLinkClass = clsx(actionLinkClass, "bg-accent text-accent-ink");

export const secondaryLinkClass = clsx(actionLinkClass, "bg-surface-2 font-medium text-text");

export const compactLinkClass = clsx(secondaryLinkClass, "min-h-8 px-3 text-[13px]");

export const goalPreferencesTarget = {
	kind: "plugin-preferences",
	packageId: PLUGIN_PACKAGE_ID,
} as const;

export type HomeNoun =
	| "templates"
	| "weekly_goal"
	| "measurements"
	| "your_workouts"
	| "personal_bests"
	| "muscle_activity";

export function SavedViewLink(props: { readonly slug: string; readonly children: ReactNode }) {
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	return (
		<PluginLink
			className={linkClass}
			to={{
				kind: "saved-view",
				reference: { kind: "plugin", slug: props.slug, pluginId: identity.pluginId },
			}}
		>
			{props.children}
		</PluginLink>
	);
}

export function Chips(props: { readonly more: number; readonly names: readonly string[] }) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{[...props.names, ...(props.more > 0 ? [`+${props.more}`] : [])].map((name) => (
				<span
					key={name}
					className="rounded-pill bg-surface-2 px-2 py-0.5 text-[12px] text-text-muted"
				>
					{name}
				</span>
			))}
		</div>
	);
}

export function HomeSection(props: {
	readonly id: string;
	readonly title: Text;
	readonly hint?: ReactNode;
	readonly link?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<section aria-labelledby={props.id} className="flex min-w-0 flex-col gap-3 font-ui">
			<SectionHeader id={props.id} hint={props.hint} link={props.link} title={props.title} />
			{props.children}
		</section>
	);
}

export function HomeCard(props: {
	readonly title: Text;
	readonly label: Text;
	readonly hint?: ReactNode;
	readonly link?: ReactNode;
	readonly className?: string;
	readonly children: ReactNode;
}) {
	return (
		<section aria-label={props.label} className={clsx(cardClass, props.className)}>
			<SectionHeader hint={props.hint} link={props.link} title={props.title} />
			{props.children}
		</section>
	);
}

export function QueryBody<A>(props: {
	readonly noun: HomeNoun;
	readonly result: RyotQueryResult<A>;
	readonly children: (data: A) => ReactNode;
}) {
	const text = useFitnessMessages();
	const { result } = props;
	if (result.data !== undefined) {
		return props.children(result.data);
	}
	if (result.isError) {
		return (
			<div className="flex flex-col items-start gap-3">
				<StatusMessage tone="error">
					{text("client.home.load-failed", { noun: props.noun })}
				</StatusMessage>
				<Button variant="secondary" onClick={result.refetch}>
					{text("common.action.try-again")}
				</Button>
			</div>
		);
	}
	return (
		<StatusMessage tone="pending">
			{text("client.home.loading", { noun: props.noun })}
		</StatusMessage>
	);
}

function SectionHeader(props: {
	readonly title: Text;
	readonly hint?: ReactNode;
	readonly link?: ReactNode;
	readonly id?: string | undefined;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
				<h2 id={props.id} className={cardHeadingClass}>
					{props.title}
				</h2>
				{props.hint === undefined ? null : (
					<span className="text-[12.5px] text-text-muted">{props.hint}</span>
				)}
			</div>
			{props.link}
		</div>
	);
}
