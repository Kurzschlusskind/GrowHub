import { createLightingAdapter } from "./lighting/adapter";

export const deviceCatalog = {
  "lighting-rs485": {
    label: "RS485 Licht",
    createAdapter: createLightingAdapter,
  },
  irrigation: {
    label: "Bewaesserung",
    createAdapter: () => null,
  },
  climate: {
    label: "Klima",
    createAdapter: () => null,
  },
};
