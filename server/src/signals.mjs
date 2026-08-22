import { execFile } from "node:child_process";

// Signal outputs on the server host (spec/growhub-server.md): a light channel
// (beacon, steady while an alarm is active) and a sound channel (piezo,
// beeping pattern). On a Raspberry Pi the pins are driven via the stock CLI
// tools (`pinctrl`, fallback `gpioset`); with driver "none" (or no config)
// states are only logged — that keeps development machines working.
//
// config.signalOutputs = {
//   "driver": "pinctrl" | "gpioset" | "none",
//   "chip": 0,
//   "light": { "pin": 17, "activeLow": false },
//   "sound": { "pin": 27, "activeLow": false }
// }

export function createSignals(config, log) {
  const driver = config?.driver || "none";
  const chip = config?.chip ?? 0;
  const state = { light: false, sound: false };
  let beepTimer = null;
  let beepOn = false;

  function drive(channel, on) {
    const output = config?.[channel];
    if (!output || typeof output.pin !== "number") return;
    const level = output.activeLow ? !on : on;
    if (driver === "pinctrl") {
      execFile("pinctrl", ["set", String(output.pin), "op", level ? "dh" : "dl"], (err) => {
        if (err) log(`[signals] pinctrl fehlgeschlagen: ${err.message}`);
      });
    } else if (driver === "gpioset") {
      execFile("gpioset", [String(chip), `${output.pin}=${level ? 1 : 0}`], (err) => {
        if (err) log(`[signals] gpioset fehlgeschlagen: ${err.message}`);
      });
    } else {
      log(`[signals] ${channel} ${on ? "AN" : "AUS"} (driver: none)`);
    }
  }

  function setAlarm(active) {
    if (state.light !== active) {
      state.light = active;
      drive("light", active);
    }
    if (active && !beepTimer) {
      state.sound = true;
      beepOn = true;
      drive("sound", true);
      beepTimer = setInterval(() => {
        beepOn = !beepOn;
        drive("sound", beepOn);
      }, 1000);
      beepTimer.unref?.();
    }
    if (!active && beepTimer) {
      clearInterval(beepTimer);
      beepTimer = null;
      state.sound = false;
      drive("sound", false);
    }
  }

  return {
    setAlarm,
    status: () => ({ driver, light: state.light, sound: state.sound }),
  };
}
