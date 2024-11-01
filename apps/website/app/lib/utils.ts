import { $path } from "remix-routes";
import { withFragment } from "ufo";

export const startUrl = withFragment($path("/"), "start-here");

export const logoUrl =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
