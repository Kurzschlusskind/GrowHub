#pragma once

#include <Arduino.h>
#include <array>
#include <vector>
#include <string>

struct RS485Frame {
    std::array<uint8_t, 5> channels{};
    uint8_t sumByte{0};
    bool includeHeader{true};

    RS485Frame();
    RS485Frame(const std::array<uint8_t, 5>& ch, bool header = true);

    void recomputeSum();
    std::vector<uint8_t> toBytes() const;
    String toHexString() const;
    static RS485Frame fromPercentages(float ch1Percent, float ch2Percent,
                                       const std::array<uint8_t, 5>& rawChannels,
                                       bool header = true);
};

struct ParsedFrame {
    std::array<uint8_t, 5> channels{};
    uint8_t receivedSum{0};
    uint8_t calculatedSum{0};
    bool sumValid{false};
    bool hadHeader{false};
    bool isShort{false};
    String rawHex;
    uint32_t timestampMs{0};
};

uint8_t computeChecksum(const std::array<uint8_t, 5>& channels);
RS485Frame makeFrameFromChannels(const std::array<uint8_t, 5>& channels, bool header = true);

