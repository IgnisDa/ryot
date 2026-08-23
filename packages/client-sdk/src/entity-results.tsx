import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import type { EntitySyncState } from "@ryot-app/client-ui-sdk/sync";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	Component,
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ComponentType,
	type ReactNode,
} from "react";

import type { RyotClient } from "./index";
import { createRyotQuery, useRyotQuery, useRyotSchedule, type RyotQuery } from "./react";
import { PluginLink } from "./routing";
import type { RyotSchedule } from "./schedule";

export type EntityResultsLayout = "grid" | "list";

export type EntityReference = EntitySyncState & {
	readonly entityId: string;
	readonly ownerPluginId: string | null;
	readonly entitySchemaSlug: string;
	readonly name: string | null;
};

export type EntityPresentationComponentProps<Data> = {
	readonly data: Data;
	readonly reference: EntityReference;
	readonly viewContext: JsonValue;
};

export type EntityPresentationLoader<Data = unknown> = (context: {
	readonly client: RyotClient;
	readonly signal: AbortSignal;
	readonly references: readonly EntityReference[];
}) => Promise<Readonly<Record<string, Data>>>;

export type EntityPresentationDefinition = {
	readonly loader: EntityPresentationLoader;
	readonly component: ComponentType<EntityPresentationComponentProps<unknown>>;
};

export const defineEntityPresentation = <Data,>(definition: {
	readonly loader: EntityPresentationLoader<Data>;
	readonly component: ComponentType<EntityPresentationComponentProps<Data>>;
}): EntityPresentationDefinition => {
	// This is the existential boundary: callers are checked with Data, then registries erase it.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return definition as unknown as EntityPresentationDefinition;
};

export type EntityPresentationRegistration = {
	readonly ownerPluginId: string;
	readonly entitySchemaSlug: string;
	readonly layout: EntityResultsLayout;
	readonly definition: EntityPresentationDefinition;
};

type BatchInput = { readonly references: readonly EntityReference[] };
type PresentationRuntime = {
	readonly definition: EntityPresentationDefinition;
	readonly query: RyotQuery<BatchInput, Readonly<Record<string, unknown>>>;
};

type ScheduledTask = {
	started: boolean;
	readonly signal: AbortSignal;
	readonly run: () => Promise<void>;
	readonly rejectQueued: () => void;
};

const abortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException("The presentation batch was aborted", "AbortError");

const createBatchScheduler = (schedule: RyotSchedule) => {
	let active = 0;
	let scheduled: (() => void) | undefined;
	let disposed = false;
	const queue: ScheduledTask[] = [];
	const drain = () => {
		scheduled = undefined;
		if (disposed) {
			return;
		}
		while (active < 4) {
			const task = queue.shift();
			if (!task) {
				return;
			}
			if (task.signal.aborted) {
				task.rejectQueued();
				continue;
			}
			task.started = true;
			active++;
			void task.run().finally(() => {
				active--;
				scheduleDrain();
			});
		}
	};
	const scheduleDrain = () => {
		if (!disposed && scheduled === undefined) {
			scheduled = schedule.after(0, drain);
		}
	};
	return {
		run: <Data,>(signal: AbortSignal, run: () => Promise<Data>) =>
			new Promise<Data>((resolve, reject) => {
				const task: ScheduledTask = {
					signal,
					started: false,
					rejectQueued: () => reject(abortReason(signal)),
					run: () => Promise.resolve().then(run).then(resolve, reject),
				};
				const onAbort = () => {
					if (!task.started) {
						const index = queue.indexOf(task);
						if (index >= 0) {
							queue.splice(index, 1);
						}
						task.rejectQueued();
					}
				};
				signal.addEventListener("abort", onAbort, { once: true });
				queue.push(task);
				drain();
			}),
		dispose: () => {
			disposed = true;
			scheduled?.();
			scheduled = undefined;
			for (const task of queue.splice(0)) {
				task.rejectQueued();
			}
		},
	};
};

const registryKey = (
	ownerPluginId: string,
	entitySchemaSlug: string,
	layout: EntityResultsLayout,
) => `${ownerPluginId}\u0000${entitySchemaSlug}\u0000${layout}`;

const PresentationRegistryContext = createContext<ReadonlyMap<string, PresentationRuntime> | null>(
	null,
);

export const EntityPresentationRegistryProvider = ({
	children,
	registrations,
}: {
	readonly children: ReactNode;
	readonly registrations: readonly EntityPresentationRegistration[];
}) => {
	const schedule = useRyotSchedule();
	const runtime = useMemo(() => {
		const scheduler = createBatchScheduler(schedule);
		const registry = new Map<string, PresentationRuntime>();
		for (const registration of registrations) {
			const definition = registration.definition;
			const query = createRyotQuery<BatchInput, Readonly<Record<string, unknown>>>(
				async ({ client, input, signal }) => {
					const requested = new Set(input.references.map(({ entityId }) => entityId));
					const result = await scheduler.run(signal, () =>
						definition.loader({ client, signal, references: input.references }),
					);
					for (const entityId of Object.keys(result)) {
						if (!requested.has(entityId)) {
							throw new Error(`Presentation returned unrequested entity "${entityId}"`);
						}
					}
					return result;
				},
				{ cancelOnUnmount: true },
			);
			registry.set(
				registryKey(registration.ownerPluginId, registration.entitySchemaSlug, registration.layout),
				{ definition, query },
			);
		}
		return { registry, scheduler };
	}, [registrations, schedule]);
	useEffect(() => () => runtime.scheduler.dispose(), [runtime]);
	return (
		<PresentationRegistryContext.Provider value={runtime.registry}>
			{children}
		</PresentationRegistryContext.Provider>
	);
};

const BasicEntityLink = ({ reference }: { readonly reference: EntityReference }) => (
	<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
		{reference.name ?? reference.entitySchemaSlug}
	</PluginLink>
);

const ItemFailure = ({
	reference,
	message,
	onRetry,
}: {
	readonly reference: EntityReference;
	readonly message: string;
	readonly onRetry?: () => void;
}) => (
	<article>
		<StatusMessage tone="error">{message}</StatusMessage>
		<BasicEntityLink reference={reference} />
		{onRetry && (
			<Button type="button" variant="text" onClick={onRetry}>
				Retry
			</Button>
		)}
	</article>
);

class PresentationErrorBoundary extends Component<
	{
		readonly children: ReactNode;
		readonly onRetry: () => void;
		readonly reference: EntityReference;
	},
	{ readonly failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		if (this.state.failed) {
			return (
				<ItemFailure
					reference={this.props.reference}
					message="This entity could not be displayed."
					onRetry={() => {
						this.setState({ failed: false });
						this.props.onRetry();
					}}
				/>
			);
		}
		return this.props.children;
	}
}

const PresentedEntity = ({
	input,
	runtime,
	reference,
	viewContext,
}: {
	readonly input: BatchInput;
	readonly viewContext: JsonValue;
	readonly reference: EntityReference;
	readonly runtime: PresentationRuntime;
}) => {
	const result = useRyotQuery(runtime.query, input);
	const [attempt, setAttempt] = useState(0);
	if (result.isPending) {
		return <StatusMessage tone="pending">Loading {reference.name ?? "entity"}...</StatusMessage>;
	}
	if (result.isError) {
		return (
			<ItemFailure
				reference={reference}
				onRetry={result.refetch}
				message="This entity could not be loaded."
			/>
		);
	}
	const data = result.data?.[reference.entityId];
	if (data === undefined) {
		return (
			<ItemFailure
				reference={reference}
				onRetry={result.refetch}
				message="The presentation did not return this entity."
			/>
		);
	}
	const Presentation = runtime.definition.component;
	return (
		<PresentationErrorBoundary
			key={attempt}
			reference={reference}
			onRetry={() => setAttempt((value) => value + 1)}
		>
			<Presentation data={data} reference={reference} viewContext={viewContext} />
		</PresentationErrorBoundary>
	);
};

type ResolvedItem =
	| { readonly reference: EntityReference; readonly runtime: null }
	| {
			readonly input: BatchInput;
			readonly reference: EntityReference;
			readonly runtime: PresentationRuntime;
	  };

export const EntityResults = ({
	layout,
	references,
	viewContext,
}: {
	readonly viewContext: JsonValue;
	readonly layout: EntityResultsLayout;
	readonly references: readonly EntityReference[];
}) => {
	const registry = useContext(PresentationRegistryContext);
	if (!registry) {
		throw new Error("EntityResults must be used in a bootstrapped client application");
	}
	const items = useMemo(() => {
		const grouped = new Map<PresentationRuntime, EntityReference[]>();
		const runtimes = references.map((reference) => {
			const runtime =
				reference.ownerPluginId === null
					? undefined
					: registry.get(registryKey(reference.ownerPluginId, reference.entitySchemaSlug, layout));
			if (runtime) {
				const group = grouped.get(runtime) ?? [];
				group.push(reference);
				grouped.set(runtime, group);
			}
			return runtime;
		});
		const inputs = new Map<PresentationRuntime, Map<string, BatchInput>>();
		for (const [runtime, group] of grouped) {
			const runtimeInputs = new Map<string, BatchInput>();
			inputs.set(runtime, runtimeInputs);
			const unique = [
				...new Map(group.map((reference) => [reference.entityId, reference])).values(),
			];
			unique.sort((left, right) => left.entityId.localeCompare(right.entityId));
			for (let offset = 0; offset < unique.length; offset += 100) {
				const input = { references: unique.slice(offset, offset + 100) };
				for (const reference of input.references) {
					runtimeInputs.set(reference.entityId, input);
				}
			}
		}
		return references.map<ResolvedItem>((reference, index) => {
			const runtime = runtimes[index];
			if (!runtime) {
				return { reference, runtime: null };
			}
			const input = inputs.get(runtime)?.get(reference.entityId);
			if (!input) {
				throw new Error("Entity presentation batch input is missing");
			}
			return { input, reference, runtime };
		});
	}, [layout, references, registry]);
	return (
		<div
			style={
				layout === "grid"
					? {
							gap: "1rem",
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
						}
					: { display: "grid", gap: "0.75rem" }
			}
		>
			{items.map((item) =>
				item.runtime === null ? (
					<article key={item.reference.entityId}>
						<BasicEntityLink reference={item.reference} />
						{(item.reference.populationStatus === "pending" ||
							item.reference.translationStatus === "pending") && (
							<StatusMessage tone="pending">Syncing...</StatusMessage>
						)}
					</article>
				) : (
					<PresentedEntity
						input={item.input}
						runtime={item.runtime}
						viewContext={viewContext}
						reference={item.reference}
						key={item.reference.entityId}
					/>
				),
			)}
		</div>
	);
};
