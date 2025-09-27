#include "FrameParser.h"

#include <algorithm>

namespace {
constexpr uint8_t kHeaderFirst = 0xF1;
constexpr uint8_t kHeaderSecond = 0xE2;
constexpr uint8_t kTerminator = 0xF3;
constexpr size_t kMaxFrameSize = 16;

String bufferToHex(const std::vector<uint8_t>& buffer) {
    String hex;
    char temp[4];
    for (size_t i = 0; i < buffer.size(); ++i) {
        snprintf(temp, sizeof(temp), "%02X", buffer[i]);
        hex += temp;
        if (i + 1 < buffer.size()) {
            hex += " ";
        }
    }
    return hex;
}
}  // namespace

FrameParser::FrameParser(Callback cb) : callback_(std::move(cb)) { buffer_.reserve(16); }

void FrameParser::reset() { buffer_.clear(); }

void FrameParser::feed(uint8_t byte) {
    if (buffer_.size() >= kMaxFrameSize) {
        buffer_.clear();
    }

    buffer_.push_back(byte);
    if (byte == kTerminator) {
        emitFrame();
        buffer_.clear();
    }
}

void FrameParser::emitFrame() {
    if (buffer_.empty()) {
        return;
    }

    std::vector<uint8_t> working = buffer_;
    if (working.back() != kTerminator) {
        return;
    }
    working.pop_back();

    ParsedFrame parsed;
    parsed.timestampMs = millis();
    parsed.rawHex = bufferToHex(buffer_);

    if (working.size() >= 2 && working[0] == kHeaderFirst && working[1] == kHeaderSecond) {
        parsed.hadHeader = true;
        working.erase(working.begin(), working.begin() + 2);
    }

    if (working.size() < 2) {
        return;
    }

    parsed.receivedSum = working.back();
    working.pop_back();

    parsed.isShort = working.size() < 5;
    size_t channelCount = std::min<size_t>(5, working.size());
    for (size_t i = 0; i < channelCount; ++i) {
        parsed.channels[i] = working[i];
    }
    for (size_t i = channelCount; i < parsed.channels.size(); ++i) {
        parsed.channels[i] = 0;
    }

    parsed.calculatedSum = computeChecksum(parsed.channels);
    parsed.sumValid = parsed.calculatedSum == parsed.receivedSum;

    if (callback_) {
        callback_(parsed);
    }
}

