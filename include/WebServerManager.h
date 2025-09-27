#pragma once

#include "CalibrationMapping.h"
#include "ConfigManager.h"
#include "Frame.h"
#include "RS485Manager.h"
#include <ESPAsyncWebServer.h>
#include <vector>
#include <array>

struct SystemState {
    float ch1Percent{0};
    float ch2Percent{0};
    uint32_t heartbeatIntervalMs{2000};
    bool heartbeatEnabled{false};
    bool allowTransmit{false};
    std::array<uint8_t, 5> lastRaw{{0, 0, 0, 0, 0}};
};

class WebServerManager {
  public:
    WebServerManager(ConfigManager& config, RS485Manager& rs485, SystemState& state);
    void begin();
    void loop();
    void broadcastFrame(const RS485Frame& frame, bool dryRun);
    void broadcastParsed(const ParsedFrame& parsed);
    void log(const String& message);

  private:
    ConfigManager& config_;
    RS485Manager& rs485_;
    SystemState& state_;
    AsyncWebServer server_{80};
    AsyncWebSocket ws_{"/ws"};
    std::vector<String> logBuffer_;
    const size_t maxLogs_{1000};

    void handleWebSocketMessage(void* arg, uint8_t* data, size_t len);
    void sendState(AsyncWebSocketClient* client = nullptr);
    void sendLogs(AsyncWebSocketClient* client);
    void setupRoutes();
};

