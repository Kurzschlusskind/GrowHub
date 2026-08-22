#pragma once

#include <ESPAsyncWebServer.h>

#include "IrrigationController.h"
#include "Topology.h"

// HTTP layer for spec/irrigation-controller.md: JSON in/out, permissive CORS
// (the GrowHub app runs in a browser), errors as { "error": "…" }.
class WebService {
 public:
  void begin(Topology* topology, IrrigationController* controller);

 private:
  AsyncWebServer server_{80};
  Topology* topology_ = nullptr;
  IrrigationController* controller_ = nullptr;

  void sendJson(AsyncWebServerRequest* request, int code, const String& body);
  void sendError(AsyncWebServerRequest* request, int code, const String& message);
};
