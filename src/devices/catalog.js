import { Droplets, Fan, Lightbulb } from "lucide-react";
import { createLightingAdapter } from "./lighting/adapter";
import { createIrrigationAdapter } from "./irrigation/adapter";

// Device registry: one entry per controller type. A type without a
// createAdapter is shown in the UI but marked as not yet implemented.
export const deviceCatalog = {
  "lighting-rs485": {
    label: "Licht",
    detail: "RS485 · 2 Kanäle",
    icon: Lightbulb,
    createAdapter: createLightingAdapter,
  },
  irrigation: {
    label: "Bewässerung",
    detail: "Mock — Hardware folgt",
    icon: Droplets,
    createAdapter: createIrrigationAdapter,
  },
  climate: {
    label: "Klima",
    detail: "geplant",
    icon: Fan,
  },
};
