#pragma once

#include "CalibrationMapping.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>
#include <LittleFS.h>
#include <vector>

struct Preset {
    String name;
    float ch1Percent{0};
    float ch2Percent{0};
};

class ConfigManager {
  public:
    bool begin();

    CalibrationMapping& mapping();
    const CalibrationMapping& mapping() const;

    bool loadMapping();
    bool saveMapping();

    bool loadPresets();
    bool savePresets() const;

    std::vector<Preset>& presets();
    const std::vector<Preset>& presets() const;

    void setIdentityMode(bool identity);

  private:
    CalibrationMapping mapping_;
    std::vector<Preset> presets_;

    bool loadMappingInternal(fs::FS& fs);
    bool saveMappingInternal(fs::FS& fs) const;
    bool loadPresetsInternal(fs::FS& fs);
    bool savePresetsInternal(fs::FS& fs) const;
};

