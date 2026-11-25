import { Autocomplete } from "@base-ui/react/autocomplete";
import type { Text } from "@ryot-app/i18n/text";
import { createContext, type ReactNode, type Ref, useContext } from "react";

type Action = {
	readonly key: string;
	readonly label: string;
	readonly content: ReactNode;
	readonly onSelect: () => void;
};

type ActionGroup = {
	readonly key: string;
	readonly label: string;
	readonly items: readonly Action[];
	readonly count?: string | undefined;
};

const Groups = createContext<readonly ActionGroup[]>([]);

export function ActionSearchInput({
	ref,
	...props
}: {
	readonly label: Text;
	readonly busy: boolean;
	readonly placeholder: Text;
	readonly ref: Ref<HTMLInputElement>;
}) {
	return (
		<Autocomplete.Input
			ref={ref}
			aria-busy={props.busy}
			aria-label={props.label}
			placeholder={props.placeholder}
			className="h-12 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-subtle pointer-fine:text-sm"
		/>
	);
}

export function ActionSearch(props: {
	readonly query: string;
	readonly children: ReactNode;
	readonly autoHighlight: boolean;
	readonly groups: readonly ActionGroup[];
	readonly onQueryChange: (query: string) => void;
}) {
	return (
		<Autocomplete.Root<readonly ActionGroup[]>
			open
			inline
			filter={null}
			keepHighlight
			value={props.query}
			items={props.groups}
			itemToStringValue={(item) => item.label}
			autoHighlight={props.autoHighlight ? "always" : false}
			onValueChange={(value, details) => {
				if (details.reason !== "item-press") {
					props.onQueryChange(value);
				}
			}}
		>
			<Groups value={props.groups}>{props.children}</Groups>
		</Autocomplete.Root>
	);
}

export function ActionSearchResults(props: { readonly label: Text }) {
	const groups = useContext(Groups);
	return (
		<Autocomplete.List aria-label={props.label} className="flex flex-col gap-2">
			{groups.map((group) => (
				<Autocomplete.Group key={group.key} items={group.items} className="flex flex-col gap-0.5">
					<Autocomplete.GroupLabel className="flex justify-between px-2.5 py-1 text-micro font-semibold tracking-wide text-text-subtle uppercase">
						{group.label}
						{group.count !== undefined && (
							<span aria-hidden="true" className="font-normal tabular-nums">
								{group.count}
							</span>
						)}
					</Autocomplete.GroupLabel>
					{group.items.map((item) => (
						<Autocomplete.Item
							value={item}
							key={item.key}
							onClick={item.onSelect}
							className="flex min-h-9 cursor-pointer scroll-mt-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover data-highlighted:bg-nav-indicator"
						>
							{item.content}
						</Autocomplete.Item>
					))}
				</Autocomplete.Group>
			))}
		</Autocomplete.List>
	);
}
