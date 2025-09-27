#include "RS485Manager.h"

RS485Manager::RS485Manager(HardwareSerial& serial, int dePin, int rePin)
    : serial_(serial), dePin_(dePin), rePin_(rePin) {}

void RS485Manager::begin(uint32_t baudRate) {
    serial_.begin(baudRate, SERIAL_8N1, /*rxPin=*/16, /*txPin=*/17);
    if (dePin_ >= 0) {
        pinMode(dePin_, OUTPUT);
        digitalWrite(dePin_, LOW);
    }
    if (rePin_ >= 0) {
        pinMode(rePin_, OUTPUT);
        digitalWrite(rePin_, LOW);
    }
}

void RS485Manager::setAllowTransmit(bool allow) { allowTransmit_ = allow; }

bool RS485Manager::allowTransmit() const { return allowTransmit_; }

void RS485Manager::queueFrame(const RS485Frame& frame, bool dryRun) {
    txQueue_.push(frame);
    dryRunQueue_.push(dryRun || !allowTransmit_);
}

void RS485Manager::process() {
    if (txQueue_.empty()) {
        return;
    }

    RS485Frame frame = txQueue_.front();
    bool dryRun = dryRunQueue_.front();

    txQueue_.pop();
    dryRunQueue_.pop();

    if (!dryRun) {
        setDriverEnable(true);
        auto bytes = frame.toBytes();
        serial_.write(bytes.data(), bytes.size());
        serial_.flush();
        delayMicroseconds(200);
        setDriverEnable(false);
    }

    if (onSend_) {
        onSend_(frame, dryRun);
    }
}

void RS485Manager::flush() {
    while (!txQueue_.empty()) {
        process();
    }
}

void RS485Manager::setOnSend(std::function<void(const RS485Frame&, bool)> cb) { onSend_ = std::move(cb); }

void RS485Manager::setDriverEnable(bool enabled) {
    if (dePin_ >= 0) {
        digitalWrite(dePin_, enabled ? HIGH : LOW);
    }
    if (rePin_ >= 0) {
        digitalWrite(rePin_, enabled ? HIGH : LOW);
    }
}

