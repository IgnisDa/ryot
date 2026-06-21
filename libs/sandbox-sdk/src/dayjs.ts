import dayjsFactory from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjsFactory.extend(customParseFormat);

export type { ConfigType, Dayjs, ManipulateType, OpUnitType, QUnitType } from "dayjs";
export const dayjs = dayjsFactory;
export default dayjsFactory;
