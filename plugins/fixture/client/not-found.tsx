import { useMessages } from "@ryot-app/plugin-client-sdk/react";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

const NotFound = () => {
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	return (
		<main>
			<h1>{text("not-found.title")}</h1>
		</main>
	);
};

export default NotFound;
