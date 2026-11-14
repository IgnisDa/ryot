import { Checkbox, Field, TextField } from "@ryot-app/plugin-ui-sdk";
import type { ReactNode } from "react";

export function PublicationDetailsFields(props: {
	readonly title: string;
	readonly children?: ReactNode;
	readonly showOwnerName: boolean;
	readonly onTitleChange: (title: string) => void;
	readonly onShowOwnerNameChange: (showOwnerName: boolean) => void;
}) {
	return (
		<>
			<Field label="Title">
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
				label="Show my name to visitors"
				onChange={(event) => props.onShowOwnerNameChange(event.target.checked)}
			/>
			<p className="text-xs text-text-muted">
				Visitors see these items as they change, but not your activity, ratings, or other
				collections.
			</p>
		</>
	);
}
