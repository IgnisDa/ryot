import type { ReactNode } from "react";

export const schemaSlugLabel = (entitySchemaSlug: string) => entitySchemaSlug.split("-").join(" ");

export function Eyebrow(props: { readonly children: ReactNode }) {
	return (
		<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
			{props.children}
		</span>
	);
}
