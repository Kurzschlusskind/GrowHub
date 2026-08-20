#pragma once

#include <Arduino.h>
#include <vector>
#include <utility>

struct MappingPoint {
    float percent{0.0f};
    uint8_t raw{0};
};

class CalibrationMapping {
  public:
    CalibrationMapping();

    void setIdentity(bool identity);
    bool isIdentity() const;

    void setPoints(const std::vector<MappingPoint>& pts);
    const std::vector<MappingPoint>& points() const;

    uint8_t evaluate(float percent) const;

    static std::vector<MappingPoint> defaultPoints();

  private:
    std::vector<MappingPoint> points_;
    bool identity_{false};
};

