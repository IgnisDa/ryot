import { Field, TextField } from "@ryot-app/plugin-ui-sdk";
import { normalizeSlug } from "@ryot-app/ts-utils/slug";
import { useState } from "react";

export const usePageIdentity = (initialName = "") => {
	const [name, setName] = useState(initialName);
	const [slug, setSlug] = useState<null | string>(null);
	return {
		name,
		setSlug,
		setName,
		slug: slug ?? normalizeSlug(name),
		complete: name.trim() !== "" && (slug ?? normalizeSlug(name)).trim() !== "",
	};
};

export function PageIdentityFields(props: {
	readonly disabled: boolean;
	readonly identity: ReturnType<typeof usePageIdentity>;
}) {
	const { identity } = props;
	return (
		<>
			<Field label="Page name">
				{(control) => (
					<TextField
						{...control}
						required
						value={identity.name}
						disabled={props.disabled}
						onChange={(event) => identity.setName(event.target.value)}
					/>
				)}
			</Field>
			<Field label="Page address">
				{(control) => (
					<TextField
						{...control}
						required
						className="font-mono"
						value={identity.slug}
						disabled={props.disabled}
						onChange={(event) => identity.setSlug(event.target.value)}
					/>
				)}
			</Field>
		</>
	);
}
