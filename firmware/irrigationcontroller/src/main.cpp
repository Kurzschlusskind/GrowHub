#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_task_wdt.h>

#include "IrrigationController.h"
#include "Outputs.h"
#include "Topology.h"
#include "Version.h"
#include "WebService.h"

namespace {
Topology topology;
Outputs outputs;
IrrigationController controller;
SignatureVerifier verifier;
WebService web;
bool topologyOk = false;

constexpr uint32_t kWatchdogSeconds = 10;

void connectWifi() {
  File file = LittleFS.open("/wifi.json", "r");
  if (!file) {
    Serial.println("[wifi] /wifi.json fehlt — siehe data/wifi.example.json");
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) {
    Serial.println("[wifi] /wifi.json ungültig");
    return;
  }
  String hostname = doc["hostname"] | "growhub-irrigation";
  // Optional installation secret: enables write-request signature checks
  // (spec/signing.md). Empty = signing disabled.
  verifier.begin(doc["apiSecret"] | "");
  Serial.printf("[auth] Signierung %s\n", verifier.enabled() ? "aktiv" : "aus");
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostname.c_str());
  WiFi.setAutoReconnect(true);
  WiFi.begin(doc["ssid"].as<const char*>(), doc["password"].as<const char*>());
  Serial.printf("[wifi] verbinde mit %s …\n", doc["ssid"].as<const char*>());
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.printf("\nGrowHub Irrigation Controller %s (spec %s)\n", FIRMWARE_VERSION, SPEC_VERSION);

  // Hardware watchdog: if the firmware hangs, reboot into the fail-safe
  // boot state (spec §6).
  esp_task_wdt_init(kWatchdogSeconds, true);
  esp_task_wdt_add(nullptr);

  if (!LittleFS.begin(true)) {
    Serial.println("[fs] LittleFS-Mount fehlgeschlagen");
  }

  topologyOk = topology.load();
  if (!topologyOk) {
    Serial.println("[topology] /topology.json fehlt oder ungültig — Ausgänge bleiben aus");
  }

  // Fail-safe first: every output off before anything else runs (spec §6).
  if (topologyOk) {
    outputs.begin(topology);
    controller.begin(&topology, &outputs);
    web.begin(&topology, &controller, &verifier);
  }

  connectWifi();

  // NTP with local timezone; schedules stay suspended until the clock is
  // valid (spec §4).
  configTzTime("CET-1CEST,M3.5.0,M10.5.0/3", "pool.ntp.org", "time.nist.gov");
}

void loop() {
  esp_task_wdt_reset();
  if (topologyOk) controller.tick();
  delay(50);
}
