import type { Entitlement } from "@ryot-app/contract/schema/entitlement";
import type { ReactNode } from "react";

import { Notice } from "./feedback";

const entitlementNames = { pro: "Ryot Pro" } as const satisfies Record<Entitlement, string>;
const entitlementBadges = { pro: "Pro" } as const satisfies Record<Entitlement, string>;

export const entitlementName = (entitlement: Entitlement) => entitlementNames[entitlement];

export const entitlementRequiredMessage = (entitlement: Entitlement, feature?: string) =>
	feature === undefined
		? `This requires ${entitlementNames[entitlement]}.`
		: `${feature} requires ${entitlementNames[entitlement]}.`;

export const entitlementActionLabel = (
	label: string,
	entitlement: Entitlement,
	granted: boolean,
) => (granted ? label : `${label} (${entitlementBadges[entitlement]})`);

export function EntitlementNotice(props: {
	readonly icon?: ReactNode;
	readonly feature?: string;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly entitlement: Entitlement;
}) {
	return (
		<Notice
			tone="info"
			icon={props.icon}
			action={props.action}
			title={`${entitlementNames[props.entitlement]} required`}
			{...(props.className === undefined ? {} : { className: props.className })}
		>
			{entitlementRequiredMessage(props.entitlement, props.feature)}
		</Notice>
	);
}
