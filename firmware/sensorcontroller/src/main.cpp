#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <time.h>

#include "SignatureVerifier.h"

// GrowHub Sensor Controller — implements spec/sensor-controller.md.
// A pure pass-through slave: sensors are declared in data/sensors.json and
// read through providers; the device reports values and never decides.
// To integrate real hardware (SCD30/41, NDIR, pressure, …): add your
// driver's read code to readSensor() below and set the sensor's "provider"
// in sensors.json accordingly. Everything else stays untouched.

#define FIRMWARE_VERSION "0.1.0"
#define SPEC_VERSION "1.0.0"

namespace {
struct SensorDef {
  String id;
  String quantity;
  String unit;
  String name;
  String provider;
};

std::vector<SensorDef> sensors;
SignatureVerifier verifier;
AsyncWebServer server(80);
bool configOk = false;

constexpr uint32_t kWatchdogSeconds = 10;

// --- providers ------------------------------------------------------------

// "demo": deterministic pseudo-measurements (diurnal swing + wobble) so the
// firmware is testable without any wired sensor.
double demoValue(const String& quantity) {
  double t = millis() / 1000.0;
  double wobble = sin(t / 47.0) + sin(t / 13.0) * 0.5;
  if (quantity == "temperature") return round((25.5 + wobble * 0.4) * 10) / 10.0;
  if (quantity == "humidity") return round((60.0 + wobble) * 10) / 10.0;
  if (quantity == "co2") return round(750 + wobble * 25);
  return round(wobble * 100) / 100.0;
}

// Returns the current value for a sensor, or NAN when it cannot measure —
// NAN is reported as null (spec §2), never as a stale fake.
double readSensor(const SensorDef& sensor) {
  if (sensor.provider == "demo") return demoValue(sensor.quantity);
  // <-- hook real drivers here, e.g.:
  // if (sensor.provider == "scd41") return scd41.readMeasurement(sensor.quantity);
  return NAN;
}

// --- config ---------------------------------------------------------------

bool loadSensors() {
  File file = LittleFS.open("/sensors.json", "r");
  if (!file) return false;
  JsonDocument doc;
  if (deserializeJson(doc, file)) {
    file.close();
    return false;
  }
  file.close();
  for (JsonObject entry : doc["sensors"].as<JsonArray>()) {
    SensorDef sensor;
    sensor.id = entry["id"].as<String>();
    sensor.quantity = entry["quantity"].as<String>();
    sensor.unit = entry["unit"] | "";
    sensor.name = entry["name"] | "";
    sensor.provider = entry["provider"] | "demo";
    if (sensor.id.length() && sensor.quantity.length()) sensors.push_back(sensor);
  }
  return !sensors.empty();
}

// --- http helpers ---------------------------------------------------------

String* bodyBuffer(AsyncWebServerRequest* request) {
  if (!request->_tempObject) request->_tempObject = new String();
  return static_cast<String*>(request->_tempObject);
}

void collectBody(AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
  String* body = bodyBuffer(request);
  if (index == 0) body->reserve(total);
  for (size_t i = 0; i < len; i++) body->concat((char)data[i]);
}

void sendJson(AsyncWebServerRequest* request, int code, const String& body) {
  request->send(code, "application/json", body);
}

void sendError(AsyncWebServerRequest* request, int code, const String& message) {
  JsonDocument doc;
  doc["error"] = message;
  String out;
  serializeJson(doc, out);
  sendJson(request, code, out);
}

// --- routes ---------------------------------------------------------------

void setupRoutes() {
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type, X-GrowHub-Timestamp, X-GrowHub-Signature");

  server.on("/api/sensors/capabilities", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["spec"] = SPEC_VERSION;
    doc["firmware"] = FIRMWARE_VERSION;
    JsonArray list = doc["sensors"].to<JsonArray>();
    for (const SensorDef& sensor : sensors) {
      JsonObject obj = list.add<JsonObject>();
      obj["id"] = sensor.id;
      obj["quantity"] = sensor.quantity;
      obj["unit"] = sensor.unit;
      if (sensor.name.length()) obj["name"] = sensor.name;
    }
    String out;
    serializeJson(doc, out);
    sendJson(request, 200, out);
  });

  server.on("/api/sensors/readings", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray list = doc["readings"].to<JsonArray>();
    for (const SensorDef& sensor : sensors) {
      JsonObject obj = list.add<JsonObject>();
      obj["sensor"] = sensor.id;
      double value = readSensor(sensor);
      if (isnan(value)) obj["value"] = nullptr;
      else obj["value"] = value;
    }
    String out;
    serializeJson(doc, out);
    sendJson(request, 200, out);
  });

  server.on("/api/sensors/health", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["uptimeSeconds"] = (uint32_t)(millis() / 1000UL);
    switch (esp_reset_reason()) {
      case ESP_RST_POWERON: doc["resetReason"] = "power-on"; break;
      case ESP_RST_TASK_WDT:
      case ESP_RST_INT_WDT:
      case ESP_RST_WDT: doc["resetReason"] = "watchdog"; break;
      case ESP_RST_BROWNOUT: doc["resetReason"] = "brownout"; break;
      case ESP_RST_SW: doc["resetReason"] = "software"; break;
      default: doc["resetReason"] = "other"; break;
    }
    doc["heapFreeBytes"] = ESP.getFreeHeap();
    JsonObject wifi = doc["wifi"].to<JsonObject>();
    wifi["connected"] = WiFi.isConnected();
    wifi["ssid"] = WiFi.SSID();
    wifi["ip"] = WiFi.localIP().toString();
    wifi["rssi"] = WiFi.RSSI();
    bool clockValid = (uint64_t)time(nullptr) > 1600000000ULL;
    doc["clockValid"] = clockValid;
    if (clockValid) {
      time_t now = time(nullptr);
      struct tm utc;
      gmtime_r(&now, &utc);
      char buffer[24];
      strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
      doc["time"] = buffer;
    } else {
      doc["time"] = nullptr;
    }
    String out;
    serializeJson(doc, out);
    sendJson(request, 200, out);
  });

  // Config mirror (spec §3): stores the server's config hash for drift and
  // tamper detection; the device never interprets the payload.
  server.on("/api/sensors/config-mirror", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    File file = LittleFS.open("/mirror.json", "r");
    if (file) {
      deserializeJson(doc, file);
      file.close();
    }
    JsonDocument out;
    if (doc["hash"].is<const char*>()) out["hash"] = doc["hash"];
    else out["hash"] = nullptr;
    out["updatedAt"] = doc["updatedAt"] | 0ULL;
    String text;
    serializeJson(out, text);
    sendJson(request, 200, text);
  });

  server.on("/api/sensors/config-mirror", HTTP_POST,
    [](AsyncWebServerRequest* request) {
      String error;
      const String& body = *bodyBuffer(request);
      if (!verifier.verify("POST", request->url(), body,
                           request->header("X-GrowHub-Timestamp"),
                           request->header("X-GrowHub-Signature"), error)) {
        sendError(request, 401, error);
        return;
      }
      JsonDocument doc;
      if (deserializeJson(doc, body)) {
        sendError(request, 400, "Ungültiges JSON");
        return;
      }
      doc["updatedAt"] = (uint64_t)time(nullptr) * 1000ULL;
      // Atomic persist: temp + rename (LittleFS rename does not overwrite).
      File file = LittleFS.open("/mirror.json.tmp", "w");
      if (!file) {
        sendError(request, 500, "Speichern fehlgeschlagen");
        return;
      }
      serializeJson(doc, file);
      file.close();
      LittleFS.remove("/mirror.json");
      LittleFS.rename("/mirror.json.tmp", "/mirror.json");
      sendJson(request, 200, "{\"ok\":true}");
    }, nullptr, collectBody);

  server.onNotFound([](AsyncWebServerRequest* request) {
    if (request->method() == HTTP_OPTIONS) {
      request->send(204);
      return;
    }
    sendError(request, 404, "Unbekannter Endpunkt");
  });

  server.begin();
}

void connectWifi() {
  File file = LittleFS.open("/wifi.json", "r");
  if (!file) {
    Serial.println("[wifi] /wifi.json fehlt — siehe data/wifi.example.json");
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, file)) {
    file.close();
    Serial.println("[wifi] /wifi.json ungültig");
    return;
  }
  file.close();
  String hostname = doc["hostname"] | "growhub-sensors";
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
  Serial.printf("\nGrowHub Sensor Controller %s (spec %s)\n", FIRMWARE_VERSION, SPEC_VERSION);

  esp_task_wdt_init(kWatchdogSeconds, true);
  esp_task_wdt_add(nullptr);

  if (!LittleFS.begin(true)) Serial.println("[fs] LittleFS-Mount fehlgeschlagen");
  configOk = loadSensors();
  if (!configOk) Serial.println("[sensors] /sensors.json fehlt oder ungültig");
  if (configOk) setupRoutes();
  connectWifi();
  configTzTime("CET-1CEST,M3.5.0,M10.5.0/3", "pool.ntp.org", "time.nist.gov");
}

void loop() {
  esp_task_wdt_reset();
  delay(100);
}
