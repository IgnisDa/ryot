import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { ScrollView, View } from "react-native";

import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";

import { ProviderSearchPanel } from "./provider-search-panel";

export const PROVIDER_ADD_TITLE = "Add from a provider";

export const useProviderAddFlow = () => useSearchParamModal("add");

export function ProviderAddHost(props: {
	readonly isOpen: boolean;
	readonly onClose: () => void;
	readonly initialQuery?: string;
	readonly onImported: () => void;
	readonly entitySchemaSlug: EntitySchemaSlug;
}) {
	return (
		<SearchParamModalHost
			closeLabel="Close"
			isOpen={props.isOpen}
			onClose={props.onClose}
			title={PROVIDER_ADD_TITLE}
		>
			<ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
				<View className="gap-3 p-4">
					<ProviderSearchPanel
						onClose={props.onClose}
						onImported={props.onImported}
						initialQuery={props.initialQuery}
						entitySchemaSlug={props.entitySchemaSlug}
					/>
				</View>
			</ScrollView>
		</SearchParamModalHost>
	);
}
