#include "Frame.h"

namespace {
constexpr uint8_t kHeaderFirst = 0xF1;
constexpr uint8_t kHeaderSecond = 0xE2;
constexpr uint8_t kTerminator = 0xF3;

String bytesToHex(const std::vector<uint8_t>& bytes) {
    String hex;
    char buf[4];
    for (size_t i = 0; i < bytes.size(); ++i) {
        snprintf(buf, sizeof(buf), "%02X", bytes[i]);
        hex += buf;
        if (i + 1 < bytes.size()) {
            hex += " ";
        }
    }
    return hex;
}
}  // namespace

RS485Frame::RS485Frame() : channels{0, 0, 0, 0, 0}, sumByte(0), includeHeader(true) {}

RS485Frame::RS485Frame(const std::array<uint8_t, 5>& ch, bool header)
    : channels(ch), includeHeader(header) {
    recomputeSum();
}

void RS485Frame::recomputeSum() { sumByte = computeChecksum(channels); }

std::vector<uint8_t> RS485Frame::toBytes() const {
    std::vector<uint8_t> frame;
    frame.reserve(includeHeader ? 9 : 7);
    if (includeHeader) {
        frame.push_back(kHeaderFirst);
        frame.push_back(kHeaderSecond);
    }
    for (const auto& value : channels) {
        frame.push_back(value);
    }
    frame.push_back(sumByte);
    frame.push_back(kTerminator);
    return frame;
}

String RS485Frame::toHexString() const { return bytesToHex(toBytes()); }

RS485Frame RS485Frame::fromPercentages(float /*ch1Percent*/, float /*ch2Percent*/,
                                       const std::array<uint8_t, 5>& rawChannels,
                                       bool header) {
    RS485Frame frame(rawChannels, header);
    frame.recomputeSum();
    return frame;
}

uint8_t computeChecksum(const std::array<uint8_t, 5>& channels) {
    uint16_t sum = 0;
    for (auto value : channels) {
        sum += value;
    }
    return static_cast<uint8_t>(sum & 0xFF);
}

RS485Frame makeFrameFromChannels(const std::array<uint8_t, 5>& channels, bool header) {
    RS485Frame frame(channels, header);
    frame.recomputeSum();
    return frame;
}

