import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	ActionIcon,
	Button,
	Group,
	Modal,
	Select,
	Stack,
	Text,
	TextInput,
	Title,
	rem,
} from "@mantine/core";
import {
	randomId,
	useDebouncedValue,
	useDidUpdate,
	useListState,
} from "@mantine/hooks";
import {
	type MediaCollectionFilter,
	MediaCollectionPresenceFilter,
	MediaCollectionStrategyFilter,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/ts-utils";
import {
	IconFilterOff,
	IconPlus,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { produce } from "immer";
import { type ReactNode, useState } from "react";
import {
	useCoreDetails,
	useNonHiddenUserCollections,
} from "~/lib/shared/hooks";
import type { OnboardingTourStepTargets } from "~/lib/state/onboarding-tour";
import { ProRequiredAlert } from ".";

export const FiltersModal = (props: {
	title?: string;
	opened: boolean;
	children: ReactNode;
	resetFilters: () => void;
	closeFiltersModal: () => void;
}) => {
	return (
		<Modal
			centered
			opened={props.opened}
			withCloseButton={false}
			onClose={props.closeFiltersModal}
		>
			<Stack>
				<Group justify="space-between">
					<Title order={3}>{props.title || "Filters"}</Title>
					<ActionIcon
						onClick={() => {
							props.resetFilters();
							props.closeFiltersModal();
						}}
					>
						<IconFilterOff size={24} />
					</ActionIcon>
				</Group>
				{props.children}
			</Stack>
		</Modal>
	);
};

export const CollectionsFilter = (props: {
	applied: MediaCollectionFilter[];
	onFiltersChanged: (val: MediaCollectionFilter[]) => void;
}) => {
	const coreDetails = useCoreDetails();
	const collections = useNonHiddenUserCollections();
	const [parent] = useAutoAnimate();
	const [filters, filtersHandlers] = useListState<{
		id: string;
		data: MediaCollectionFilter;
	}>(props.applied.map((a) => ({ data: a, id: randomId() })));

	useDidUpdate(() => {
		const applicableFilters = coreDetails.isServerKeyValidated
			? filters
			: filters.slice(0, 1);
		props.onFiltersChanged(applicableFilters.map((f) => f.data));
	}, [filters]);

	return (
		<Stack gap="xs">
			<Group wrap="nowrap" justify="space-between">
				<Text size="sm" c="dimmed">
					Collection filters
				</Text>
				<Button
					size="compact-xs"
					variant="transparent"
					leftSection={<IconPlus size={14} />}
					onClick={() => {
						filtersHandlers.append({
							id: randomId(),
							data: {
								collectionId: "",
								strategy: MediaCollectionStrategyFilter.And,
								presence: MediaCollectionPresenceFilter.PresentIn,
							},
						});
					}}
				>
					Add
				</Button>
			</Group>
			{filters.length > 0 ? (
				<Stack gap="xs" px={{ md: 4 }} ref={parent}>
					{filters.map((f, idx) => (
						<Group key={f.id} gap="xs" justify="space-between" wrap="nowrap">
							{idx !== 0 ? (
								<Button
									size="compact-md"
									w={rem(70)}
									variant="default"
									fz={{ base: 10, md: 12 }}
									onClick={() => {
										filtersHandlers.setItem(
											idx,
											produce(f, (d) => {
												d.data.strategy =
													d.data.strategy === MediaCollectionStrategyFilter.And
														? MediaCollectionStrategyFilter.Or
														: MediaCollectionStrategyFilter.And;
											}),
										);
									}}
								>
									{changeCase(f.data.strategy)}
								</Button>
							) : null}
							<Button
								size="compact-md"
								w={rem(170)}
								variant="default"
								fz={{ base: 10, md: 12 }}
								onClick={() => {
									filtersHandlers.setItem(
										idx,
										produce(f, (d) => {
											d.data.presence =
												d.data.presence ===
												MediaCollectionPresenceFilter.PresentIn
													? MediaCollectionPresenceFilter.NotPresentIn
													: MediaCollectionPresenceFilter.PresentIn;
										}),
									);
								}}
							>
								{changeCase(f.data.presence)}
							</Button>
							<Select
								size="xs"
								searchable
								allowDeselect={false}
								value={f.data.collectionId}
								placeholder="Select a collection"
								data={collections.map((c) => ({
									label: c.name,
									value: c.id.toString(),
								}))}
								onChange={(v) =>
									filtersHandlers.setItem(
										idx,
										produce(f, (d) => {
											d.data.collectionId = v || "";
										}),
									)
								}
							/>
							<ActionIcon
								size="xs"
								color="red"
								onClick={() => filtersHandlers.remove(idx)}
							>
								<IconX />
							</ActionIcon>
						</Group>
					))}
					{filters.length > 1 && !coreDetails.isServerKeyValidated ? (
						<ProRequiredAlert tooltipLabel="Only the first filter will be applied" />
					) : null}
				</Stack>
			) : null}
		</Stack>
	);
};

export const DebouncedSearchInput = (props: {
	value: string;
	queryParam?: string;
	placeholder?: string;
	onChange: (query: string) => void;
	tourControl?: {
		target: OnboardingTourStepTargets;
		onQueryChange: (query: string) => void;
	};
}) => {
	const [query, setQuery] = useState(props.value);
	const [debounced] = useDebouncedValue(query, 1000);

	useDidUpdate(() => {
		setQuery(props.value);
	}, [props.value]);

	useDidUpdate(() => {
		const query = debounced.trim().toLowerCase();
		if (props.onChange) {
			props.onChange(query);
			return;
		}
		props.tourControl?.onQueryChange(query);
	}, [debounced]);

	return (
		<TextInput
			name="query"
			value={query}
			autoComplete="off"
			autoCapitalize="none"
			style={{ flexGrow: 1 }}
			leftSection={<IconSearch />}
			className={props.tourControl?.target}
			placeholder={props.placeholder || "Search..."}
			onChange={(e) => setQuery(e.currentTarget.value)}
			rightSection={
				query ? (
					<ActionIcon onClick={() => setQuery("")}>
						<IconX size={16} />
					</ActionIcon>
				) : null
			}
		/>
	);
};
