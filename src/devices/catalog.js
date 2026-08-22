import { Droplets, Fan, Lightbulb, Thermometer } from "lucide-react";
import { createLightingAdapter } from "./lighting/adapter";
import { createIrrigationAdapter } from "./irrigation/adapter";
import { irrigationViews } from "./irrigation/views";
import { createSensorsAdapter } from "./sensors/adapter";
import { sensorViews } from "./sensors/views";

// Device registry: one entry per controller type. A device module is
// self-contained (adapter + mock + views); a type without a createAdapter is
// shown in the UI but marked as not yet implemented. Types with a `views`
// map are rendered generically by the app shell; the lighting views still
// live in main.jsx and migrate here next.
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
    views: irrigationViews,
  },
  sensors: {
    label: "Sensorik",
    detail: "Mock — Hardware folgt",
    icon: Thermometer,
    createAdapter: createSensorsAdapter,
    views: sensorViews,
  },
  climate: {
    label: "Klima",
    detail: "geplant",
    icon: Fan,
  },
};
