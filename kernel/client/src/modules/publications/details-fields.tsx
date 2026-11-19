import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Checkbox, Field, TextField } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

export function PublicationDetailsFields(props: {
	readonly title: string;
	readonly children?: ReactNode;
	readonly showOwnerName: boolean;
	readonly onTitleChange: (title: string) => void;
	readonly onShowOwnerNameChange: (showOwnerName: boolean) => void;
}) {
	const t = useT();
	return (
		<>
			<Field label={t(kernelMessage("client.publications.details.title"))}>
				{(control) => (
					<TextField
						{...control}
						maxLength={120}
						value={props.title}
						onChange={(event) => props.onTitleChange(event.target.value)}
					/>
				)}
			</Field>
			{props.children}
			<Checkbox
				checked={props.showOwnerName}
				label={t(kernelMessage("client.publications.details.show-owner"))}
				onChange={(event) => props.onShowOwnerNameChange(event.target.checked)}
			/>
			<p className="text-xs text-text-muted">
				{t(kernelMessage("client.publications.details.visitors-note"))}
			</p>
		</>
	);
}
