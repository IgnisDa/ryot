import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";

import { ShowScreen } from "./show/screen";

const MediaHome = () => (
	<PluginScreenFrame title="Media">
		<p>The Media workspace will be added in a later tracer.</p>
	</PluginScreenFrame>
);

bootstrapClientPlugin({
	home: { component: MediaHome },
	entities: { show: { component: ShowScreen } },
});
