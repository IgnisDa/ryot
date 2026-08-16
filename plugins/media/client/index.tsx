import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";

import { ShowEntityScreen } from "./show-entity";

const MediaHome = () => (
	<PluginScreenFrame title="Media">
		<p>The Media workspace will be added in a later tracer.</p>
	</PluginScreenFrame>
);

bootstrapClientPlugin({
	home: { component: MediaHome },
	entities: { show: { component: ShowEntityScreen } },
});
