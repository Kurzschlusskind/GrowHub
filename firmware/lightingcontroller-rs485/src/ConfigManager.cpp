#include "ConfigManager.h"

namespace {
constexpr const char* kMappingFile = "/mapping.json";
constexpr const char* kPresetFile = "/presets.json";
}

bool ConfigManager::begin() {
    if (!LittleFS.begin(true)) {
        return false;
    }
    loadMapping();
    loadPresets();
    return true;
}

CalibrationMapping& ConfigManager::mapping() { return mapping_; }
const CalibrationMapping& ConfigManager::mapping() const { return mapping_; }

bool ConfigManager::loadMapping() { return loadMappingInternal(LittleFS); }

bool ConfigManager::saveMapping() const { return saveMappingInternal(LittleFS); }

bool ConfigManager::loadPresets() { return loadPresetsInternal(LittleFS); }

bool ConfigManager::savePresets() const { return savePresetsInternal(LittleFS); }

std::vector<Preset>& ConfigManager::presets() { return presets_; }
const std::vector<Preset>& ConfigManager::presets() const { return presets_; }

void ConfigManager::setIdentityMode(bool identity) { mapping_.setIdentity(identity); }

bool ConfigManager::loadMappingInternal(fs::FS& fs) {
    File file = fs.open(kMappingFile, "r");
    if (!file) {
        mapping_.setPoints(CalibrationMapping::defaultPoints());
        return saveMappingInternal(fs);
    }

    DynamicJsonDocument doc(2048);
    auto error = deserializeJson(doc, file);
    file.close();
    if (error) {
        mapping_.setPoints(CalibrationMapping::defaultPoints());
        return false;
    }

    bool identity = doc["identity"].as<bool>();
    mapping_.setIdentity(identity);

    std::vector<MappingPoint> pts;
    for (JsonObject obj : doc["points"].as<JsonArray>()) {
        MappingPoint point;
        point.percent = obj["percent"].as<float>();
        point.raw = obj["raw"].as<int>();
        pts.push_back(point);
    }
    if (!pts.empty()) {
        mapping_.setPoints(pts);
    } else {
        mapping_.setPoints(CalibrationMapping::defaultPoints());
    }
    return true;
}

bool ConfigManager::saveMappingInternal(fs::FS& fs) const {
    DynamicJsonDocument doc(2048);
    doc["identity"] = mapping_.isIdentity();
    JsonArray points = doc.createNestedArray("points");
    for (const auto& point : mapping_.points()) {
        JsonObject obj = points.createNestedObject();
        obj["percent"] = point.percent;
        obj["raw"] = point.raw;
    }

    File file = fs.open(kMappingFile, "w");
    if (!file) {
        return false;
    }
    bool ok = serializeJson(doc, file) > 0;
    file.close();
    return ok;
}

bool ConfigManager::loadPresetsInternal(fs::FS& fs) {
    File file = fs.open(kPresetFile, "r");
    presets_.clear();
    if (!file) {
        return savePresetsInternal(fs);
    }

    DynamicJsonDocument doc(4096);
    auto error = deserializeJson(doc, file);
    file.close();
    if (error) {
        return false;
    }
    for (JsonObject obj : doc["presets"].as<JsonArray>()) {
        Preset preset;
        preset.name = obj["name"].as<const char*>();
        preset.ch1Percent = obj["ch1"].as<float>();
        preset.ch2Percent = obj["ch2"].as<float>();
        presets_.push_back(preset);
    }
    return true;
}

bool ConfigManager::savePresetsInternal(fs::FS& fs) const {
    DynamicJsonDocument doc(4096);
    JsonArray arr = doc.createNestedArray("presets");
    for (const auto& preset : presets_) {
        JsonObject obj = arr.createNestedObject();
        obj["name"] = preset.name;
        obj["ch1"] = preset.ch1Percent;
        obj["ch2"] = preset.ch2Percent;
    }

    File file = fs.open(kPresetFile, "w");
    if (!file) {
        return false;
    }
    bool ok = serializeJson(doc, file) > 0;
    file.close();
    return ok;
}

