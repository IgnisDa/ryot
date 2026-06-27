import type { PluginFunc } from "dayjs";
import dayjsCustomParseFormat from "dayjs/plugin/customParseFormat.js";

export const customParseFormat: PluginFunc = (option, dayjsClass, dayjsFactory) => {
	Reflect.apply(dayjsCustomParseFormat, undefined, [option, dayjsClass, dayjsFactory]);
};
export default customParseFormat;
