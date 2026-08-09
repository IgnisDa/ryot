import type { ListedIntegrationProvider } from "@ryot/contract/modules/integrations/schemas";
import { Text, View } from "react-native";

import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";
import { schemaReviewRows } from "@/modules/ui/schema-form/review-summary";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import { integrationLotDetail, integrationLotLabel } from "./provider-selection";

export function IntegrationReviewStep(props: {
	readonly pending: boolean;
	readonly onBack: () => void;
	readonly onConnect: () => void;
	readonly values: SchemaFormValues;
	readonly failureDetail: string | undefined;
	readonly provider: ListedIntegrationProvider;
}) {
	const rows = [
		...schemaReviewRows(props.provider.settingsSchema, props.values),
		...schemaReviewRows(props.provider.commonSchema, props.values),
	];
	return (
		<View className="gap-4">
			<View className="gap-3 rounded-lg border border-border bg-surface p-3">
				<View className="flex-row items-center justify-between gap-3">
					<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-semibold text-base text-text">
						{props.provider.name}
					</Text>
					<Text className="rounded-pill border border-border-strong px-2 py-0.5 font-ui-medium text-[11px] text-text-muted">
						{integrationLotLabel(props.provider.lot)}
					</Text>
				</View>
				{rows.length === 0 ? (
					<Text className="font-ui text-sm text-text-muted">
						This service needs nothing else from you.
					</Text>
				) : (
					<View className="gap-2">
						{rows.map((row) => (
							<View key={row.label} className="gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
								<Text className="font-ui text-xs text-text-subtle sm:w-40">{row.label}</Text>
								<Text className="min-w-0 flex-1 font-ui-medium text-sm text-text">{row.value}</Text>
							</View>
						))}
					</View>
				)}
			</View>
			<Text className="font-ui text-sm leading-6 text-text-muted">
				{integrationLotDetail(props.provider.lot)}
			</Text>
			{props.failureDetail === undefined ? null : <FormMessage>{props.failureDetail}</FormMessage>}
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					label="Connect"
					variant="primary"
					className="sm:px-6"
					pending={props.pending}
					onPress={props.onConnect}
					pendingLabel="Connecting..."
				/>
				<AppButton
					label="Back"
					size="default"
					className="sm:px-6"
					onPress={props.onBack}
					disabled={props.pending}
				/>
			</View>
		</View>
	);
}
