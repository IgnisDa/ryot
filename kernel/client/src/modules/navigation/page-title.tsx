import {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

const APPLICATION_NAME = "Ryot";

type TitleEntry = { readonly id: string; readonly title: string };

type PageTitleRegistry = {
	readonly clear: (id: string) => void;
	readonly set: (id: string, title: string) => void;
};

const PageTitleRegistryContext = createContext<PageTitleRegistry | undefined>(undefined);

export function usePageTitle(title: string) {
	const id = useId();
	const registry = useContext(PageTitleRegistryContext);
	if (registry === undefined) {
		throw new Error("usePageTitle must be used inside PageTitleProvider");
	}

	useEffect(() => {
		registry.set(id, title);
		return () => registry.clear(id);
	}, [id, registry, title]);
}

export function PageTitleProvider(props: { readonly children: ReactNode }) {
	const [entries, setEntries] = useState<readonly TitleEntry[]>([]);
	const registry = useMemo<PageTitleRegistry>(
		() => ({
			clear: (id) => setEntries((current) => current.filter((entry) => entry.id !== id)),
			set: (id, title) =>
				setEntries((current) => [...current.filter((entry) => entry.id !== id), { id, title }]),
		}),
		[],
	);
	const resolved = entries.at(-1)?.title;

	useEffect(() => {
		document.title =
			resolved === undefined ? APPLICATION_NAME : `${resolved} — ${APPLICATION_NAME}`;
	}, [resolved]);

	return (
		<PageTitleRegistryContext value={registry}>
			{props.children}
			<RouteAnnouncer title={resolved} />
		</PageTitleRegistryContext>
	);
}

function RouteAnnouncer(props: { readonly title: string | undefined }) {
	const announced = useRef(false);
	const [message, setMessage] = useState("");

	useEffect(() => {
		if (props.title === undefined) {
			return;
		}
		if (!announced.current) {
			announced.current = true;
			return;
		}
		setMessage(props.title);
	}, [props.title]);

	return (
		<p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="route-announcer">
			{message}
		</p>
	);
}
