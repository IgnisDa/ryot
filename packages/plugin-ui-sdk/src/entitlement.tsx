import type { Entitlement } from "@ryot-app/contract/schema/entitlement";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { ReactNode } from "react";

import { Notice } from "./feedback";

export const entitlementRequiredMessage = (entitlement: Entitlement) =>
	kernelMessage("error.sandbox.entitlement-required", { entitlement });

export const entitlementActionLabel = (
	t: (message: Message) => Text,
	label: Text,
	entitlement: Entitlement,
	granted: boolean,
) => (granted ? label : t(kernelMessage("ui.entitlement.action-label", { label, entitlement })));

export function EntitlementNotice(props: {
	readonly detail?: Text;
	readonly icon?: ReactNode;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly entitlement: Entitlement;
}) {
	const t = useT();
	return (
		<Notice
			tone="info"
			icon={props.icon}
			action={props.action}
			title={t(kernelMessage("ui.entitlement.required-title", { entitlement: props.entitlement }))}
			{...(props.className === undefined ? {} : { className: props.className })}
		>
			{props.detail ?? t(entitlementRequiredMessage(props.entitlement))}
		</Notice>
	);
}
