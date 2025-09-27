#include <Arduino.h>
#include <WiFi.h>
#include <array>

#include "CalibrationMapping.h"
#include "ConfigManager.h"
#include "FrameParser.h"
#include "RS485Manager.h"
#include "WebServerManager.h"

namespace {
constexpr uint32_t kDefaultBaud = 9600;
constexpr int kDriverEnablePin = 4;
constexpr int kReceiverEnablePin = 4;
constexpr uint8_t kLedPin = 2;

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

ConfigManager configManager;
SystemState systemState;
RS485Manager rs485(Serial2, kDriverEnablePin, kReceiverEnablePin);
WebServerManager* webServer = nullptr;
uint32_t lastHeartbeat = 0;
FrameParser* parser = nullptr;

void setupWiFi();
void handleHeartbeat();
void handleSerialRx();

std::array<uint8_t, 5> buildRawFromState() {
    std::array<uint8_t, 5> raw{{0, 0, 0, 0, 0}};
    raw[0] = configManager.mapping().evaluate(systemState.ch1Percent);
    raw[1] = configManager.mapping().evaluate(systemState.ch2Percent);
    return raw;
}

}  // namespace

void setup() {
    pinMode(kLedPin, OUTPUT);
    digitalWrite(kLedPin, LOW);

    Serial.begin(115200);
    delay(100);
    Serial.println("Lighting Controller booting...");

    if (!configManager.begin()) {
        Serial.println("Failed to initialize filesystem; using defaults.");
    }

    systemState.heartbeatIntervalMs = 2000;
    systemState.allowTransmit = false;
    systemState.heartbeatEnabled = false;
    systemState.ch1Percent = 0;
    systemState.ch2Percent = 0;
    systemState.lastRaw = buildRawFromState();

    setupWiFi();

    rs485.begin(kDefaultBaud);
    rs485.setAllowTransmit(systemState.allowTransmit);
    rs485.setOnSend([](const RS485Frame& frame, bool dryRun) {
        if (webServer) {
            webServer->broadcastFrame(frame, dryRun);
        }
    });

    parser = new FrameParser([](const ParsedFrame& parsed) {
        if (webServer) {
            webServer->broadcastParsed(parsed);
        }
    });

    webServer = new WebServerManager(configManager, rs485, systemState);
    webServer->begin();
    webServer->log("System initialised in listen-only mode.");
}

void loop() {
    handleSerialRx();
    handleHeartbeat();
    if (webServer) {
        webServer->loop();
    }
    rs485.process();
}

void setupWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Connecting to WiFi");
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
        delay(500);
        Serial.print('.');
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("Connected: ");
        Serial.println(WiFi.localIP());
        if (webServer) {
            webServer->log(String("WiFi connected: ") + WiFi.localIP().toString());
        }
    } else {
        Serial.println("Failed to connect. Starting AP mode.");
        WiFi.mode(WIFI_AP);
        WiFi.softAP("GC-RS485", "gccontroller");
        IPAddress ip = WiFi.softAPIP();
        if (webServer) {
            webServer->log(String("AP mode: ") + ip.toString());
        }
    }
}

void handleHeartbeat() {
    if (!systemState.heartbeatEnabled) {
        return;
    }
    uint32_t now = millis();
    if (now - lastHeartbeat >= systemState.heartbeatIntervalMs) {
        lastHeartbeat = now;
        systemState.lastRaw = buildRawFromState();
        RS485Frame frame = makeFrameFromChannels(systemState.lastRaw);
        rs485.queueFrame(frame, !systemState.allowTransmit);
        digitalWrite(kLedPin, HIGH);
        delay(5);
        digitalWrite(kLedPin, LOW);
    }
}

void handleSerialRx() {
    while (Serial2.available() > 0) {
        int incoming = Serial2.read();
        if (incoming >= 0 && parser) {
            parser->feed(static_cast<uint8_t>(incoming));
        }
    }
}

