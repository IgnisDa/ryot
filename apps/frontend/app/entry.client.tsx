import { loadServiceWorker } from "@remix-pwa/sw";
import { RemixBrowser } from "@remix-run/react";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

loadServiceWorker();

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<RemixBrowser />
		</StrictMode>,
	);
});
