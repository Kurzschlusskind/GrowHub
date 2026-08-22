#include "WebService.h"

#include <ArduinoJson.h>

namespace {
// Collects a request body across chunks; AsyncWebServer delivers POST bodies
// in onBody callbacks.
String* bodyBuffer(AsyncWebServerRequest* request) {
  if (!request->_tempObject) request->_tempObject = new String();
  return static_cast<String*>(request->_tempObject);
}

void collectBody(AsyncWebServerRequest* request, uint8_t* data, size_t len,
                 size_t index, size_t total) {
  String* body = bodyBuffer(request);
  if (index == 0) body->reserve(total);
  for (size_t i = 0; i < len; i++) body->concat((char)data[i]);
}
}  // namespace

void WebService::begin(Topology* topology, IrrigationController* controller) {
  topology_ = topology;
  controller_ = controller;

  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server_.on("/api/irrigation/capabilities", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, topology_->capabilitiesJson());
  });
  server_.on("/api/irrigation/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, controller_->statusJson());
  });
  server_.on("/api/irrigation/health", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, controller_->healthJson());
  });
  server_.on("/api/irrigation/history", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, controller_->historyJson());
  });
  server_.on("/api/irrigation/schedules", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, controller_->schedulesJson());
  });
  server_.on("/api/irrigation/safety", HTTP_GET, [this](AsyncWebServerRequest* request) {
    sendJson(request, 200, controller_->safetyJson());
  });

  server_.on("/api/irrigation/schedules", HTTP_POST,
    [this](AsyncWebServerRequest* request) {
      String error;
      if (!controller_->applySchedules(*bodyBuffer(request), error)) {
        sendError(request, 400, error);
        return;
      }
      sendJson(request, 200, controller_->schedulesJson());
    }, nullptr, collectBody);

  server_.on("/api/irrigation/safety", HTTP_POST,
    [this](AsyncWebServerRequest* request) {
      String error;
      if (!controller_->applySafety(*bodyBuffer(request), error)) {
        sendError(request, 400, error);
        return;
      }
      sendJson(request, 200, controller_->safetyJson());
    }, nullptr, collectBody);

  server_.on("/api/irrigation/run", HTTP_POST,
    [this](AsyncWebServerRequest* request) {
      JsonDocument doc;
      if (deserializeJson(doc, *bodyBuffer(request))) {
        sendError(request, 400, "Ungültiges JSON");
        return;
      }
      String error;
      bool duplicate = false;
      bool ok = controller_->startRun(doc["valve"].as<String>(),
                                      (uint16_t)(doc["durationSeconds"] | 60),
                                      doc["runId"].as<String>(), error, duplicate);
      if (!ok) {
        sendError(request, 409, error);
        return;
      }
      sendJson(request, 200, duplicate ? "{\"ok\":true,\"duplicate\":true}" : "{\"ok\":true}");
    }, nullptr, collectBody);

  server_.on("/api/irrigation/stop", HTTP_POST,
    [this](AsyncWebServerRequest* request) {
      JsonDocument doc;
      if (deserializeJson(doc, *bodyBuffer(request))) {
        sendError(request, 400, "Ungültiges JSON");
        return;
      }
      controller_->stopRun(doc["pump"].as<String>());
      sendJson(request, 200, "{\"ok\":true}");
    }, nullptr, collectBody);

  // CORS preflight for every route.
  server_.onNotFound([this](AsyncWebServerRequest* request) {
    if (request->method() == HTTP_OPTIONS) {
      request->send(204);
      return;
    }
    sendError(request, 404, "Unbekannter Endpunkt");
  });

  server_.begin();
}

void WebService::sendJson(AsyncWebServerRequest* request, int code, const String& body) {
  request->send(code, "application/json", body);
}

void WebService::sendError(AsyncWebServerRequest* request, int code, const String& message) {
  JsonDocument doc;
  doc["error"] = message;
  String out;
  serializeJson(doc, out);
  sendJson(request, code, out);
}
