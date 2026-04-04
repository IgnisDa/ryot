import { useAtomValue } from "@effect/atom-react";
import type { EntityDefinition } from "@ryot/contract/modules/definitions/schemas";
import type { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Cause, Effect, Match } from "effect";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { AppIcon } from "@/modules/icons";

import { entityDefinitionsAtom } from "./atoms";
import { type EntityDefinitionsState, mapEntityDefinitions, providerAddError } from "./state";

function useEntityDefinitionsFailureLogging(state: EntityDefinitionsState) {
	const cause = state.status === "transport-error" ? state.cause : undefined;
	useEffect(() => {
		if (cause === undefined) {
			return;
		}
		const detail = Cause.isCause(cause) ? Cause.pretty(cause) : cause;
		Effect.runSync(Effect.logWarning("entity definitions transport-error", detail));
	}, [cause]);
}

function StatusMessage(props: { readonly title: string; readonly detail: string }) {
	return (
		<View className="min-h-48 items-center justify-center gap-2 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text className="text-center font-ui text-sm text-text-muted">{props.detail}</Text>
		</View>
	);
}

function SchemaRow(props: {
	readonly definition: EntityDefinition;
	readonly onSelect: (entitySchemaSlug: EntitySchemaSlug) => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Add a ${props.definition.name}`}
			onPress={() => props.onSelect(props.definition.slug)}
			className="flex-row items-center gap-3 rounded-lg bg-surface-2 px-3 py-3 md:bg-transparent md:hover:bg-surface-2"
		>
			<AppIcon size={18} name={props.definition.icon} className="shrink-0 text-text-muted" />
			<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-medium text-[15px] text-text">
				{props.definition.name}
			</Text>
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Pressable>
	);
}

export function ProviderAddSchemaPicker(props: {
	readonly onSelect: (entitySchemaSlug: EntitySchemaSlug) => void;
}) {
	const scope = useApiScope();
	const state = mapEntityDefinitions(useAtomValue(entityDefinitionsAtom(scope)));
	useEntityDefinitionsFailureLogging(state);

	return (
		<View className="gap-3">
			{Match.value(state).pipe(
				Match.when({ status: "loading" }, () => (
					<View className="min-h-48 items-center justify-center">
						<ActivityIndicator size="small" accessibilityLabel="Loading item types" />
					</View>
				)),
				Match.when({ status: "transport-error" }, (failure) => (
					<StatusMessage {...providerAddError(failure)} />
				)),
				Match.when({ status: "ready" }, (ready) =>
					ready.definitions.length === 0 ? (
						<StatusMessage
							title="Nothing to add yet"
							detail="No item types have a configured provider."
						/>
					) : (
						<>
							<Text className="font-ui-semibold text-base text-text">What do you want to add?</Text>
							<View className="gap-1.5">
								{ready.definitions.map((definition) => (
									<SchemaRow
										key={definition.slug}
										definition={definition}
										onSelect={props.onSelect}
									/>
								))}
							</View>
						</>
					),
				),
				Match.exhaustive,
			)}
		</View>
	);
}
