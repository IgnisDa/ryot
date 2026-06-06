// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";
import { bootstrapClientPlugin, defineClientPlugin } from "@ryot/client-plugin-sdk";

import { FixtureHome } from "./home";

bootstrapClientPlugin(defineClientPlugin({ home: FixtureHome }));
