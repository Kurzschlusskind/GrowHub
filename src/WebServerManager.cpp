#include "WebServerManager.h"

#include <ArduinoJson.h>
#include <algorithm>

namespace {
String toJson(const SystemState& state, const CalibrationMapping& mapping,
              const std::vector<Preset>& presets, const std::vector<String>& logs) {
    DynamicJsonDocument doc(8192);
    doc["type"] = "state";
    doc["ch1"] = state.ch1Percent;
    doc["ch2"] = state.ch2Percent;
    JsonArray rawArr = doc.createNestedArray("raw");
    for (auto value : state.lastRaw) {
        rawArr.add(value);
    }
    doc["heartbeatEnabled"] = state.heartbeatEnabled;
    doc["heartbeatInterval"] = state.heartbeatIntervalMs;
    doc["allowTx"] = state.allowTransmit;
    doc["identityMode"] = mapping.isIdentity();

    JsonArray points = doc.createNestedArray("mapping");
    for (const auto& point : mapping.points()) {
        JsonObject obj = points.createNestedObject();
        obj["percent"] = point.percent;
        obj["raw"] = point.raw;
    }

    JsonArray presetArray = doc.createNestedArray("presets");
    for (const auto& preset : presets) {
        JsonObject obj = presetArray.createNestedObject();
        obj["name"] = preset.name;
        obj["ch1"] = preset.ch1Percent;
        obj["ch2"] = preset.ch2Percent;
    }

    JsonArray logArray = doc.createNestedArray("logs");
    for (const auto& entry : logs) {
        logArray.add(entry);
    }

    String json;
    serializeJson(doc, json);
    return json;
}

String parsedFrameJson(const ParsedFrame& parsed) {
    DynamicJsonDocument doc(1024);
    doc["type"] = "parsed";
    doc["rawHex"] = parsed.rawHex;
    JsonArray channels = doc.createNestedArray("channels");
    for (auto value : parsed.channels) {
        channels.add(value);
    }
    doc["receivedSum"] = parsed.receivedSum;
    doc["calculatedSum"] = parsed.calculatedSum;
    doc["sumValid"] = parsed.sumValid;
    doc["hadHeader"] = parsed.hadHeader;
    doc["short"] = parsed.isShort;
    doc["timestamp"] = parsed.timestampMs;
    String json;
    serializeJson(doc, json);
    return json;
}

String frameSentJson(const RS485Frame& frame, bool dryRun) {
    DynamicJsonDocument doc(512);
    doc["type"] = "sent";
    doc["frame"] = frame.toHexString();
    doc["dryRun"] = dryRun;
    JsonArray arr = doc.createNestedArray("channels");
    for (auto value : frame.channels) {
        arr.add(value);
    }
    doc["sum"] = frame.sumByte;
    String json;
    serializeJson(doc, json);
    return json;
}

String logJson(const String& message) {
    DynamicJsonDocument doc(256);
    doc["type"] = "log";
    doc["message"] = message;
    doc["timestamp"] = millis();
    String json;
    serializeJson(doc, json);
    return json;
}

std::array<uint8_t, 5> buildRaw(const CalibrationMapping& mapping, float ch1, float ch2) {
    std::array<uint8_t, 5> raw{{0, 0, 0, 0, 0}};
    raw[0] = mapping.evaluate(ch1);
    raw[1] = mapping.evaluate(ch2);
    return raw;
}

String buildLogEntry(const String& text) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%lu", static_cast<unsigned long>(millis()));
    return String("[") + buf + "] " + text;
}
}

WebServerManager::WebServerManager(ConfigManager& config, RS485Manager& rs485, SystemState& state)
    : config_(config), rs485_(rs485), state_(state) {}

void WebServerManager::begin() {
    ws_.onEvent([this](AsyncWebSocket* server, AsyncWebSocketClient* client,
                      AwsEventType type, void* arg, uint8_t* data, size_t len) {
        if (type == WS_EVT_CONNECT) {
            sendState(client);
            sendLogs(client);
        } else if (type == WS_EVT_DATA) {
            handleWebSocketMessage(arg, data, len);
        }
    });
    server_.addHandler(&ws_);

    setupRoutes();
    server_.begin();
    log("Web server started");
}

void WebServerManager::loop() { ws_.cleanupClients(); }

void WebServerManager::broadcastFrame(const RS485Frame& frame, bool dryRun) {
    String json = frameSentJson(frame, dryRun);
    ws_.textAll(json);
    String entry = buildLogEntry(String("TX ") + (dryRun ? "(dry) " : "") + frame.toHexString());
    log(entry);
}

void WebServerManager::broadcastParsed(const ParsedFrame& parsed) {
    ws_.textAll(parsedFrameJson(parsed));
    String entry = buildLogEntry(String("RX ") + parsed.rawHex + (parsed.sumValid ? " ✅" : " ⚠️"));
    log(entry);
}

void WebServerManager::log(const String& message) {
    logBuffer_.push_back(message);
    if (logBuffer_.size() > maxLogs_) {
        logBuffer_.erase(logBuffer_.begin());
    }
    ws_.textAll(logJson(message));
}

void WebServerManager::handleWebSocketMessage(void* arg, uint8_t* data, size_t len) {
    AwsFrameInfo* info = reinterpret_cast<AwsFrameInfo*>(arg);
    if (!info || !info->final || info->index != 0 || info->len != len || info->opcode != WS_TEXT) {
        return;
    }

    String payload;
    payload.reserve(len + 1);
    for (size_t i = 0; i < len; ++i) {
        payload += static_cast<char>(data[i]);
    }

    DynamicJsonDocument doc(4096);
    auto error = deserializeJson(doc, payload);
    if (error) {
        log(String("JSON parse error: ") + error.c_str());
        return;
    }

    const String type = doc["type"].as<String>();
    if (type == "setChannels") {
        state_.ch1Percent = doc["ch1"].as<float>();
        state_.ch2Percent = doc["ch2"].as<float>();
        state_.lastRaw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
        sendState();
    } else if (type == "sendOnce") {
        auto raw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
        state_.lastRaw = raw;
        RS485Frame frame = makeFrameFromChannels(raw);
        rs485_.queueFrame(frame, !state_.allowTransmit);
        sendState();
    } else if (type == "toggleHeartbeat") {
        state_.heartbeatEnabled = doc["enabled"].as<bool>();
        sendState();
    } else if (type == "setHeartbeatInterval") {
        state_.heartbeatIntervalMs = doc["interval"].as<uint32_t>();
        sendState();
    } else if (type == "toggleTx") {
        state_.allowTransmit = doc["allow"].as<bool>();
        rs485_.setAllowTransmit(state_.allowTransmit);
        sendState();
    } else if (type == "requestState") {
        sendState();
    } else if (type == "savePreset") {
        Preset preset;
        preset.name = doc["name"].as<String>();
        preset.ch1Percent = doc["ch1"].as<float>();
        preset.ch2Percent = doc["ch2"].as<float>();
        bool replaced = false;
        for (auto& existing : config_.presets()) {
            if (existing.name == preset.name) {
                existing = preset;
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            config_.presets().push_back(preset);
        }
        config_.savePresets();
        log(String("Preset saved: ") + preset.name);
        sendState();
    } else if (type == "loadPreset") {
        String name = doc["name"].as<String>();
        for (const auto& preset : config_.presets()) {
            if (preset.name == name) {
                state_.ch1Percent = preset.ch1Percent;
                state_.ch2Percent = preset.ch2Percent;
                state_.lastRaw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
                sendState();
                break;
            }
        }
    } else if (type == "deletePreset") {
        String name = doc["name"].as<String>();
        auto& presets = config_.presets();
        presets.erase(std::remove_if(presets.begin(), presets.end(),
                                     [&](const Preset& p) { return p.name == name; }),
                      presets.end());
        config_.savePresets();
        sendState();
    } else if (type == "updateMapping") {
        std::vector<MappingPoint> points;
        for (JsonObject obj : doc["points"].as<JsonArray>()) {
            MappingPoint point;
            point.percent = obj["percent"].as<float>();
            point.raw = obj["raw"].as<int>();
            points.push_back(point);
        }
        bool identity = doc["identity"].as<bool>();
        config_.mapping().setIdentity(identity);
        if (!points.empty()) {
            config_.mapping().setPoints(points);
        }
        config_.saveMapping();
        state_.lastRaw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
        sendState();
    }
}

void WebServerManager::sendState(AsyncWebSocketClient* client) {
    String json = toJson(state_, config_.mapping(), config_.presets(), logBuffer_);
    if (client) {
        client->text(json);
    } else {
        ws_.textAll(json);
    }
}

void WebServerManager::sendLogs(AsyncWebSocketClient* client) {
    DynamicJsonDocument doc(4096);
    doc["type"] = "logSnapshot";
    JsonArray arr = doc.createNestedArray("logs");
    for (const auto& entry : logBuffer_) {
        arr.add(entry);
    }
    String json;
    serializeJson(doc, json);
    if (client) {
        client->text(json);
    }
}

void WebServerManager::setupRoutes() {
    server_.serveStatic("/", LittleFS, "/").setDefaultFile("/index.html");

    server_.on("/status", HTTP_GET, [this](AsyncWebServerRequest* request) {
        String json = toJson(state_, config_.mapping(), config_.presets(), logBuffer_);
        request->send(200, "application/json", json);
    });

    server_.on("/set", HTTP_POST, [this](AsyncWebServerRequest* request) {
        if (!request->hasParam("body", true)) {
            request->send(400, "application/json", "{\"error\":\"no body\"}");
            return;
        }
        AsyncWebParameter* body = request->getParam("body", true);
        DynamicJsonDocument doc(1024);
        auto error = deserializeJson(doc, body->value());
        if (error) {
            request->send(400, "application/json", "{\"error\":\"json\"}");
            return;
        }
        state_.ch1Percent = doc["ch1"].as<float>();
        state_.ch2Percent = doc["ch2"].as<float>();
        state_.lastRaw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
        RS485Frame frame = makeFrameFromChannels(state_.lastRaw);
        bool sendNow = doc["send"].as<bool>();
        if (sendNow) {
            rs485_.queueFrame(frame, !state_.allowTransmit);
        }
        sendState();
        request->send(200, "application/json", "{\"status\":\"ok\"}");
    });

    server_.on("/preset", HTTP_POST, [this](AsyncWebServerRequest* request) {
        if (!request->hasParam("body", true)) {
            request->send(400, "application/json", "{\"error\":\"no body\"}");
            return;
        }
        AsyncWebParameter* body = request->getParam("body", true);
        DynamicJsonDocument doc(1024);
        auto error = deserializeJson(doc, body->value());
        if (error) {
            request->send(400, "application/json", "{\"error\":\"json\"}");
            return;
        }
        Preset preset;
        preset.name = doc["name"].as<String>();
        preset.ch1Percent = doc["ch1"].as<float>();
        preset.ch2Percent = doc["ch2"].as<float>();
        config_.presets().push_back(preset);
        config_.savePresets();
        sendState();
        request->send(200, "application/json", "{\"status\":\"ok\"}");
    });

    server_.on("/mapping", HTTP_POST, [this](AsyncWebServerRequest* request) {
        if (!request->hasParam("body", true)) {
            request->send(400, "application/json", "{\"error\":\"no body\"}");
            return;
        }
        AsyncWebParameter* body = request->getParam("body", true);
        DynamicJsonDocument doc(4096);
        auto error = deserializeJson(doc, body->value());
        if (error) {
            request->send(400, "application/json", "{\"error\":\"json\"}");
            return;
        }
        std::vector<MappingPoint> points;
        for (JsonObject obj : doc["points"].as<JsonArray>()) {
            MappingPoint p;
            p.percent = obj["percent"].as<float>();
            p.raw = obj["raw"].as<int>();
            points.push_back(p);
        }
        bool identity = doc["identity"].as<bool>();
        config_.mapping().setIdentity(identity);
        if (!points.empty()) {
            config_.mapping().setPoints(points);
        }
        config_.saveMapping();
        state_.lastRaw = buildRaw(config_.mapping(), state_.ch1Percent, state_.ch2Percent);
        sendState();
        request->send(200, "application/json", "{\"status\":\"ok\"}");
    });
}

