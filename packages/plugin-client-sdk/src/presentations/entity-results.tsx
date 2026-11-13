import type { EntityPresentationPayload } from "@ryot-app/contract/modules/entities/presentation";
import type { EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	Button,
	Eyebrow,
	type ItemSelection,
	resultsLayoutClasses,
	schemaSlugLabel,
	SelectableItem,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import {
	EntityArtWell,
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	SyncPip,
} from "@ryot-app/plugin-ui-sdk/sync";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
	Component,
	type ComponentType,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { isComponentType } from "../component-type";
import {
	NavigationEnabledContext,
	PluginLink,
	usePluginScreenSurface,
} from "../navigation/routing";
import { useEntityRefresh } from "../refresh/entity-hooks";
import { usePageRefreshRequest } from "../refresh/page-registry";

export type EntityResultsLayout = "grid" | "list";

export type EntityPresentationSource = Readonly<Record<string, JsonValue>>;

export type EntityPresentationComponentProps<Data> = {
	readonly data: Data;
	readonly viewContext: JsonValue;
	readonly reference: EntityReference;
};

export type EntityReference = EntitySyncState & {
	readonly entityId: string;
	readonly name: null | string;
	readonly entitySchemaSlug: string;
	readonly ownerPluginId: null | string;
};

export type EntityPresentationDefinition = {
	readonly prepare: EntityPresentationPrepare;
	readonly entity?: EntityPresentationDefinition;
	readonly component: ComponentType<EntityPresentationComponentProps<unknown>>;
};

export type EntityPresentationPrepare<Data = unknown> = (context: {
	readonly references: readonly EntityReference[];
	readonly sources: ReadonlyMap<string, EntityPresentationSource>;
	readonly context?: undefined | EntityPresentationPayload["context"];
}) => Result.Result<Readonly<Record<string, Data>>, unknown>;

export const isEntityPresentationDefinition = (
	value: unknown,
): value is EntityPresentationDefinition =>
	typeof value === "object" &&
	value !== null &&
	"prepare" in value &&
	typeof value.prepare === "function" &&
	"component" in value &&
	isComponentType(value.component) &&
	(!("entity" in value) ||
		value.entity === undefined ||
		isEntityPresentationDefinition(value.entity));

export const defineEntityPresentation = <Data,>(definition: {
	readonly entity?: EntityPresentationDefinition;
	readonly prepare: EntityPresentationPrepare<Data>;
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
	readonly load: () => Promise<EntityPresentationDefinition>;
};

type PresentationRuntime = { readonly definition: EntityPresentationDefinition };
type PreparedPresentation =
	{ readonly success: false } | { readonly success: true; readonly data: unknown };
type PresentationEntry = {
	readonly load: () => void;
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => "idle" | "ready" | "failed" | "loading";
	readonly getRuntime: (scope: "owner" | "entity") => undefined | PresentationRuntime;
};

class PresentationLoadError extends Schema.TaggedError<
	PresentationLoadError,
	{ readonly brand: unique symbol }
>()("PresentationLoadError", { cause: Schema.Unknown }) {}

const registryKey = (
	ownerPluginId: string,
	entitySchemaSlug: string,
	layout: EntityResultsLayout,
) => `${ownerPluginId}\u0000${entitySchemaSlug}\u0000${layout}`;

const PresentationRegistryContext = createContext<null | ReadonlyMap<string, PresentationEntry>>(
	null,
);

const createPresentationRuntime = (registrations: readonly EntityPresentationRegistration[]) => {
	const registry = new Map<string, PresentationEntry>();
	for (const registration of registrations) {
		let state: ReturnType<PresentationEntry["getSnapshot"]> = "idle";
		let presentation: undefined | PresentationRuntime;
		let entityPresentation: undefined | PresentationRuntime;
		const listeners = new Set<() => void>();
		const notify = () => {
			for (const listener of listeners) {
				listener();
			}
		};
		registry.set(
			registryKey(registration.ownerPluginId, registration.entitySchemaSlug, registration.layout),
			{
				getSnapshot: () => state,
				getRuntime: (scope) => (scope === "entity" ? entityPresentation : presentation),
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				load: () => {
					if (state !== "idle") {
						return;
					}
					state = "loading";
					notify();
					void Effect.runFork(
						Effect.tryPromise({
							try: registration.load,
							catch: (cause) => new PresentationLoadError({ cause }),
						}).pipe(
							Effect.flatMap((definition) =>
								Effect.sync(() => {
									presentation = { definition };
									entityPresentation = { definition: definition.entity ?? definition };
									state = "ready";
									notify();
								}),
							),
							Effect.catch(() =>
								Effect.sync(() => {
									state = "failed";
									notify();
								}),
							),
						),
					);
				},
			},
		);
	}
	return registry;
};

export const EntityPresentationRegistryProvider = ({
	children,
	registrations,
}: {
	readonly children: ReactNode;
	readonly registrations: readonly EntityPresentationRegistration[];
}) => {
	const registry = useMemo(() => createPresentationRuntime(registrations), [registrations]);
	return (
		<PresentationRegistryContext.Provider value={registry}>
			{children}
		</PresentationRegistryContext.Provider>
	);
};

const BasicEntityLink = ({ reference }: { readonly reference: EntityReference }) => (
	<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
		{reference.name ?? reference.entitySchemaSlug}
	</PluginLink>
);

const GenericEntityCard = ({
	layout,
	reference,
}: {
	readonly reference: EntityReference;
	readonly layout: EntityResultsLayout;
}) => {
	const title = reference.name ?? schemaSlugLabel(reference.entitySchemaSlug);
	return (
		<article
			data-layout={layout}
			data-entity-id={reference.entityId}
			className={
				layout === "grid" ? "grid min-w-0 content-start gap-2" : "flex min-w-0 items-center gap-3.5"
			}
		>
			<PluginLink
				aria-label={`Open ${title}`}
				to={{ kind: "entity", entityId: reference.entityId }}
				className={layout === "grid" ? "block min-w-0" : "block shrink-0"}
			>
				<EntityArtWell
					url={undefined}
					monogram={title}
					state={fieldSyncState(null, reference)}
					className={layout === "grid" ? "aspect-3/4 w-full rounded-lg" : "h-16 w-11 rounded-sm"}
				/>
			</PluginLink>
			<div className="grid min-w-0 flex-1 gap-1">
				<Eyebrow>{schemaSlugLabel(reference.entitySchemaSlug)}</Eyebrow>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<PluginLink className="min-w-0" to={{ kind: "entity", entityId: reference.entityId }}>
						<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
							{title}
						</span>
					</PluginLink>
					{isTitleProvisional(reference) && <SyncPip reason="translating" />}
				</span>
			</div>
		</article>
	);
};

const ItemFailure = ({
	message,
	onRetry,
	reference,
}: {
	readonly message: string;
	readonly onRetry?: () => void;
	readonly reference: EntityReference;
}) => (
	<article>
		<StatusMessage tone="error">{message}</StatusMessage>
		<BasicEntityLink reference={reference} />
		{onRetry && (
			<Button type="button" variant="ghost" onClick={onRetry}>
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
	data,
	reference,
	definition,
	viewContext,
}: {
	readonly data: unknown;
	readonly viewContext: JsonValue;
	readonly reference: EntityReference;
	readonly definition: EntityPresentationDefinition;
}) => {
	const [attempt, setAttempt] = useState(0);
	const Presentation = definition.component;
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
	| { readonly kind: "failed"; readonly reference: EntityReference }
	| { readonly kind: "generic"; readonly reference: EntityReference }
	| {
			readonly kind: "pending";
			readonly entry: PresentationEntry;
			readonly reference: EntityReference;
	  }
	| {
			readonly kind: "ready";
			readonly data: unknown;
			readonly reference: EntityReference;
			readonly definition: EntityPresentationDefinition;
	  };

const EntityResultItem = ({
	item,
	layout,
	viewContext,
}: {
	readonly item: ResolvedItem;
	readonly viewContext: JsonValue;
	readonly layout: EntityResultsLayout;
}) => {
	if (item.kind === "generic") {
		return <GenericEntityCard layout={layout} reference={item.reference} />;
	}
	if (item.kind === "pending") {
		return <PendingPresentation layout={layout} entry={item.entry} reference={item.reference} />;
	}
	if (item.kind === "failed") {
		return <ItemFailure reference={item.reference} message="This entity could not be loaded." />;
	}

	return (
		<PresentedEntity
			data={item.data}
			viewContext={viewContext}
			reference={item.reference}
			definition={item.definition}
		/>
	);
};

const ObservedEntity = ({
	children,
	entityId,
	register,
}: {
	readonly entityId: string;
	readonly children: ReactNode;
	readonly register: (entityId: string, element: HTMLDivElement) => () => void;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = ref.current;
		return element ? register(entityId, element) : undefined;
	}, [entityId, register]);
	return <div ref={ref}>{children}</div>;
};

const PendingPresentation = ({
	entry,
	layout,
	reference,
}: {
	readonly entry: PresentationEntry;
	readonly reference: EntityReference;
	readonly layout: EntityResultsLayout;
}) => {
	const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
	useEffect(() => entry.load(), [entry]);
	return state === "failed" ? (
		<ItemFailure reference={reference} message="This presentation is unavailable." />
	) : (
		<article
			data-layout={layout}
			className={layout === "grid" ? "grid min-w-0 gap-2" : "flex min-w-0 items-center gap-3.5"}
		>
			<div
				aria-hidden="true"
				className={
					layout === "grid"
						? "aspect-3/4 w-full rounded-lg bg-surface animate-pulse"
						: "h-16 w-11 shrink-0 rounded-sm bg-surface animate-pulse"
				}
			/>
			<StatusMessage tone="pending">
				Loading {reference.name ?? "entity"} presentation...
			</StatusMessage>
		</article>
	);
};

export const EntityResults = ({
	layout,
	selection,
	references,
	viewContext,
	presentations,
	renderItemActions,
	navigationEnabled = true,
}: {
	readonly viewContext: JsonValue;
	readonly navigationEnabled?: boolean;
	readonly layout: EntityResultsLayout;
	readonly selection?: undefined | ItemSelection;
	readonly references: readonly EntityReference[];
	readonly presentations: ReadonlyMap<string, EntityPresentationPayload>;
	readonly renderItemActions?: undefined | ((reference: EntityReference) => ReactNode);
}) => {
	const registry = useContext(PresentationRegistryContext);
	if (!registry) {
		throw new Error("EntityResults must be used in a bootstrapped client application");
	}
	const subscribePresentations = useCallback(
		(listener: () => void) => {
			const releases = [...registry.values()].map((entry) => entry.subscribe(listener));
			return () => {
				for (const release of releases) {
					release();
				}
			};
		},
		[registry],
	);
	const presentationSnapshot = useCallback(
		() => [...registry.values()].map((entry) => entry.getSnapshot()).join(","),
		[registry],
	);
	const presentationState = useSyncExternalStore(
		subscribePresentations,
		presentationSnapshot,
		presentationSnapshot,
	);
	const { isActive, scrollRootRef } = usePluginScreenSurface();
	const requestPageRefresh = usePageRefreshRequest();
	const [visibleEntityIds, setVisibleEntityIds] = useState<ReadonlySet<string>>(() => new Set());
	const observer = useRef<null | IntersectionObserver>(null);
	const observedElements = useRef(new Map<Element, string>());
	const visibleElements = useRef(new Set<Element>());
	const visibleElementCounts = useRef(new Map<string, number>());
	const setElementVisibility = useCallback((element: Element, visible: boolean) => {
		const entityId = observedElements.current.get(element);
		if (entityId === undefined || visibleElements.current.has(element) === visible) {
			return;
		}
		const currentCount = visibleElementCounts.current.get(entityId) ?? 0;
		const nextCount = visible ? currentCount + 1 : currentCount - 1;
		if (visible) {
			visibleElements.current.add(element);
		} else {
			visibleElements.current.delete(element);
		}
		if (nextCount > 0) {
			visibleElementCounts.current.set(entityId, nextCount);
		} else {
			visibleElementCounts.current.delete(entityId);
		}
		if ((currentCount === 0) !== (nextCount === 0)) {
			setVisibleEntityIds((current) => {
				const next = new Set(current);
				if (nextCount > 0) {
					next.add(entityId);
				} else {
					next.delete(entityId);
				}
				return next;
			});
		}
	}, []);
	const clearVisibility = useCallback(() => {
		visibleElements.current.clear();
		visibleElementCounts.current.clear();
		setVisibleEntityIds((current) => (current.size === 0 ? current : new Set()));
	}, []);
	const register = useCallback(
		(entityId: string, element: HTMLDivElement) => {
			observedElements.current.set(element, entityId);
			observer.current?.observe(element);
			return () => {
				setElementVisibility(element, false);
				observedElements.current.delete(element);
				observer.current?.unobserve(element);
			};
		},
		[setElementVisibility],
	);
	useEffect(() => {
		if (!isActive) {
			clearVisibility();
			return undefined;
		}
		if (typeof IntersectionObserver === "undefined") {
			clearVisibility();
			return undefined;
		}
		const nextObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					setElementVisibility(entry.target, entry.isIntersecting);
				}
			},
			{ root: scrollRootRef.current },
		);
		observer.current = nextObserver;
		for (const element of observedElements.current.keys()) {
			nextObserver.observe(element);
		}
		return () => {
			observer.current = null;
			nextObserver.disconnect();
			clearVisibility();
		};
	}, [clearVisibility, isActive, scrollRootRef, setElementVisibility]);
	const interest = useMemo(
		() => ({ foreground: [], visible: [...visibleEntityIds].sort() }),
		[visibleEntityIds],
	);
	const refreshIdentity = JSON.stringify([layout, references.map(({ entityId }) => entityId)]);
	const { settled } = useEntityRefresh({
		interest,
		blocked: false,
		identity: refreshIdentity,
		onRefresh: () => Effect.sync(requestPageRefresh),
	});
	const items = useMemo(() => {
		const grouped = new Map<PresentationRuntime, EntityReference[]>();
		const entries = references.map((reference) => {
			const presentation =
				reference.ownerPluginId === null
					? undefined
					: registry.get(registryKey(reference.ownerPluginId, reference.entitySchemaSlug, layout));
			const runtime = presentation?.getRuntime(
				presentations.get(reference.entityId)?.scope ?? "owner",
			);
			if (runtime) {
				const group = grouped.get(runtime) ?? [];
				group.push(reference);
				grouped.set(runtime, group);
			}
			return { runtime, presentation };
		});
		const prepared = new Map<PresentationRuntime, Map<string, PreparedPresentation>>();
		for (const [runtime, group] of grouped) {
			const runtimeData = new Map<string, PreparedPresentation>();
			prepared.set(runtime, runtimeData);
			const contexts = new Map<string, EntityReference[]>();
			for (const reference of group) {
				const key = JSON.stringify(presentations.get(reference.entityId)?.context ?? null);
				const contextGroup = contexts.get(key) ?? [];
				contextGroup.push(reference);
				contexts.set(key, contextGroup);
			}
			for (const contextGroup of contexts.values()) {
				const unique = [
					...new Map(contextGroup.map((reference) => [reference.entityId, reference])).values(),
				];
				unique.sort((left, right) => left.entityId.localeCompare(right.entityId));
				for (let offset = 0; offset < unique.length; offset += 100) {
					const batchReferences = unique.slice(offset, offset + 100);
					const sources = new Map<string, EntityPresentationSource>();
					for (const reference of batchReferences) {
						const source = presentations.get(reference.entityId);
						if (
							source !== undefined &&
							source.pluginId === reference.ownerPluginId &&
							source.schemaSlug === reference.entitySchemaSlug
						) {
							sources.set(reference.entityId, source.data);
						}
					}
					let result: undefined | Result.Result<Readonly<Record<string, unknown>>, unknown>;
					if (sources.size === batchReferences.length) {
						try {
							result = runtime.definition.prepare({
								sources,
								references: batchReferences,
								context: presentations.get(batchReferences[0]?.entityId ?? "")?.context,
							});
						} catch {
							for (const reference of batchReferences) {
								runtimeData.set(reference.entityId, { success: false });
							}
							continue;
						}
					}
					if (result === undefined || Result.isFailure(result)) {
						for (const reference of batchReferences) {
							runtimeData.set(reference.entityId, { success: false });
						}
						continue;
					}
					const requested = new Set(batchReferences.map(({ entityId }) => entityId));
					const hasUnexpected = Object.keys(result.success).some(
						(entityId) => !requested.has(entityId),
					);
					for (const reference of batchReferences) {
						const data = result.success[reference.entityId];
						runtimeData.set(
							reference.entityId,
							hasUnexpected || data === undefined ? { success: false } : { data, success: true },
						);
					}
				}
			}
		}

		return references.map<ResolvedItem>((reference, index) => {
			const { runtime, presentation } = entries[index] ?? {};
			if (!runtime) {
				if (presentation) {
					return { reference, kind: "pending", entry: presentation };
				}
				return { reference, kind: "generic" };
			}
			const preparedPresentation = prepared.get(runtime)?.get(reference.entityId);
			if (preparedPresentation?.success !== true) {
				return { reference, kind: "failed" };
			}
			return {
				reference,
				kind: "ready",
				definition: runtime.definition,
				data: preparedPresentation.data,
			};
		});
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- The registry's entries change state without changing map identity.
	}, [layout, presentations, references, registry, presentationState]);
	return (
		<NavigationEnabledContext.Provider value={navigationEnabled}>
			<div className="@container">
				<div className={resultsLayoutClasses[layout]}>
					{items.map((item) => (
						<SettleHighlight
							className="rounded-lg"
							key={item.reference.entityId}
							reason={settled.get(item.reference.entityId)}
						>
							<ObservedEntity register={register} entityId={item.reference.entityId}>
								<SelectableItem
									selection={selection}
									id={item.reference.entityId}
									label={item.reference.name ?? schemaSlugLabel(item.reference.entitySchemaSlug)}
								>
									{renderItemActions === undefined || selection !== undefined ? (
										<EntityResultItem item={item} layout={layout} viewContext={viewContext} />
									) : (
										<div
											className={
												layout === "grid" ? "relative min-w-0" : "flex min-w-0 items-center gap-2"
											}
										>
											<div className="min-w-0 flex-1">
												<EntityResultItem item={item} layout={layout} viewContext={viewContext} />
											</div>
											<div
												className={
													layout === "grid"
														? "absolute top-2 right-2 rounded-sm bg-raised/90 shadow-sm backdrop-blur-sm"
														: undefined
												}
											>
												{renderItemActions(item.reference)}
											</div>
										</div>
									)}
								</SelectableItem>
							</ObservedEntity>
						</SettleHighlight>
					))}
				</div>
			</div>
		</NavigationEnabledContext.Provider>
	);
};
