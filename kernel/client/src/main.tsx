import { RegistryProvider } from "@effect/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect } from "react";
import ReactDOM from "react-dom/client";

import { applyThemePreference } from "./modules/theme/preference";
import { ClientStorage } from "./persistence/storage";
import { getRouter } from "./router";
import { makeClientRuntime, type ClientRuntime } from "./runtime";

function ClientApplication(props: {
	readonly router: ReturnType<typeof getRouter>;
	readonly runtime: ClientRuntime;
}) {
	useEffect(() => () => void props.runtime.dispose(), [props.runtime]);
	return (
		<RegistryProvider>
			<RouterProvider router={props.router} />
		</RegistryProvider>
	);
}

const rootElement = document.getElementById("app");

if (rootElement === null) {
	throw new Error("Missing application root");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	const runtime = makeClientRuntime();
	const initialThemePreference = runtime.runSync(
		Effect.flatMap(ClientStorage, (storage) => storage.getThemePreference),
	);
	applyThemePreference(document.documentElement, initialThemePreference);
	const router = getRouter({ initialThemePreference, runtime });
	root.render(<ClientApplication router={router} runtime={runtime} />);
}
