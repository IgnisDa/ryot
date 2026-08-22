import { RegistryProvider } from "@effect/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { getRouter } from "./router";

const rootElement = document.getElementById("app");

if (rootElement === null) {
	throw new Error("Missing application root");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	const router = getRouter();
	root.render(
		<RegistryProvider>
			<RouterProvider router={router} />
		</RegistryProvider>,
	);
}
