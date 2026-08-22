#pragma once

#include <ESPAsyncWebServer.h>

#include "IrrigationController.h"
#include "SignatureVerifier.h"
#include "Topology.h"

// HTTP layer for spec/irrigation-controller.md: JSON in/out, permissive CORS
// (the GrowHub app runs in a browser), errors as { "error": "…" }. Write
// endpoints verify request signatures when a secret is configured
// (spec/signing.md).
class WebService {
 public:
  void begin(Topology* topology, IrrigationController* controller, SignatureVerifier* verifier);

 private:
  AsyncWebServer server_{80};
  Topology* topology_ = nullptr;
  IrrigationController* controller_ = nullptr;
  SignatureVerifier* verifier_ = nullptr;

  bool writeAllowed(AsyncWebServerRequest* request, const String& body);
  void sendJson(AsyncWebServerRequest* request, int code, const String& body);
  void sendError(AsyncWebServerRequest* request, int code, const String& message);
};
