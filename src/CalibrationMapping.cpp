#include "CalibrationMapping.h"

#include <algorithm>
#include <cmath>

namespace {
uint8_t clampToByte(float value) {
    if (value < 0.0f) {
        return 0;
    }
    if (value > 255.0f) {
        return 255;
    }
    return static_cast<uint8_t>(std::round(value));
}
}  // namespace

CalibrationMapping::CalibrationMapping() {
    points_ = defaultPoints();
}

void CalibrationMapping::setIdentity(bool identity) { identity_ = identity; }

bool CalibrationMapping::isIdentity() const { return identity_; }

void CalibrationMapping::setPoints(const std::vector<MappingPoint>& pts) {
    points_ = pts;
    std::sort(points_.begin(), points_.end(),
              [](const MappingPoint& a, const MappingPoint& b) { return a.percent < b.percent; });
}

const std::vector<MappingPoint>& CalibrationMapping::points() const { return points_; }

uint8_t CalibrationMapping::evaluate(float percent) const {
    if (identity_) {
        return clampToByte((percent / 100.0f) * 255.0f);
    }

    if (points_.empty()) {
        return clampToByte((percent / 100.0f) * 255.0f);
    }

    if (percent <= points_.front().percent) {
        return points_.front().raw;
    }
    if (percent >= points_.back().percent) {
        return points_.back().raw;
    }

    for (size_t i = 0; i + 1 < points_.size(); ++i) {
        const auto& a = points_[i];
        const auto& b = points_[i + 1];
        if (percent >= a.percent && percent <= b.percent) {
            float ratio = (percent - a.percent) / (b.percent - a.percent);
            float rawValue = a.raw + ratio * (static_cast<float>(b.raw) - a.raw);
            return clampToByte(rawValue);
        }
    }

    return clampToByte((percent / 100.0f) * 255.0f);
}

std::vector<MappingPoint> CalibrationMapping::defaultPoints() {
    return {{0.0f, 0x00}, {25.0f, 0x26}, {50.0f, 0x3F}, {73.0f, 0x56}, {100.0f, 0x64}};
}

