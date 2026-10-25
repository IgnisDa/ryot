import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import {
	identityTupleKey,
	type PluginIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import type { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { Effect } from "effect";
import {
	Component,
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";

import { useRyotSchedule } from "../queries/provider";

export type AnalyticsSectionProps = {
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
	readonly owner: Extract<PluginIdentityReference, { readonly kind: "local" }>;
};

export type AnalyticsSectionRegistration = {
	readonly slug: string;
	readonly name: string;
	readonly icon: string;
	readonly ownerPluginId: PluginId;
	readonly load: null | (() => Promise<ComponentType<AnalyticsSectionProps>>);
};

const AnalyticsSectionsContext = createContext<readonly AnalyticsSectionRegistration[]>([]);

export const AnalyticsSectionsProvider = ({
	children,
	registrations,
}: {
	readonly children: ReactNode;
	readonly registrations: readonly AnalyticsSectionRegistration[];
}) => (
	<AnalyticsSectionsContext.Provider value={registrations}>
		{children}
	</AnalyticsSectionsContext.Provider>
);

export const useAnalyticsSections = () => useContext(AnalyticsSectionsContext);

export const analyticsSectionKey = (
	section: Pick<AnalyticsSectionRegistration, "slug" | "ownerPluginId">,
) => identityTupleKey(section.ownerPluginId, section.slug);

class SectionBoundary extends Component<
	{ readonly retry: () => void; readonly children: ReactNode },
	{ readonly failed: boolean }
> {
	override state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	override render() {
		return this.state.failed ? <SectionFailure retry={this.props.retry} /> : this.props.children;
	}
}

const SectionFailure = ({ retry }: { readonly retry: () => void }) => (
	<StatusMessage tone="error" action={{ label: "Retry", onClick: retry }}>
		Could not load this section.
	</StatusMessage>
);

type LoadedSection =
	| { readonly state: "failed" }
	| { readonly state: "loading" }
	| { readonly state: "ready"; readonly component: ComponentType<AnalyticsSectionProps> };

const SectionContent = ({
	retry,
	timeZone,
	selection,
	registration,
}: {
	readonly retry: () => void;
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
	readonly registration: AnalyticsSectionRegistration;
}) => {
	const schedule = useRyotSchedule();
	const [loaded, setLoaded] = useState<LoadedSection>({ state: "loading" });
	useEffect(() => {
		const load = registration.load;
		if (load === null) {
			return undefined;
		}
		return schedule.run(
			Effect.tryPromise(load).pipe(
				Effect.match({
					onFailure: () => setLoaded({ state: "failed" }),
					onSuccess: (component) => setLoaded({ component, state: "ready" }),
				}),
			),
			() => undefined,
		);
	}, [registration, schedule]);
	if (registration.load === null) {
		return (
			<StatusMessage tone="pending">
				Section unavailable. Reload the page after the plugin is available.
			</StatusMessage>
		);
	}
	if (loaded.state === "loading") {
		return <StatusMessage tone="pending">Loading section…</StatusMessage>;
	}
	if (loaded.state === "failed") {
		return <SectionFailure retry={retry} />;
	}
	const Section = loaded.component;
	return (
		<Section
			timeZone={timeZone}
			selection={selection}
			owner={{ kind: "local", pluginId: registration.ownerPluginId }}
		/>
	);
};

export const AnalyticsSection = ({
	timeZone,
	selection,
	registration,
}: {
	readonly timeZone: TimeZone;
	readonly selection: ReportingSelection;
	readonly registration: AnalyticsSectionRegistration;
}) => {
	const [attempt, setAttempt] = useState(0);
	const retry = () => setAttempt((value) => value + 1);
	return (
		<SectionBoundary key={attempt} retry={retry}>
			<SectionContent
				retry={retry}
				timeZone={timeZone}
				selection={selection}
				registration={registration}
			/>
		</SectionBoundary>
	);
};
