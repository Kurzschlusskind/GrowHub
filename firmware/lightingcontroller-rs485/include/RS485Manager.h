#pragma once

#include "Frame.h"
#include <Arduino.h>
#include <queue>
#include <functional>

class RS485Manager {
  public:
    RS485Manager(HardwareSerial& serial, int dePin, int rePin);

    void begin(uint32_t baudRate);
    void setAllowTransmit(bool allow);
    bool allowTransmit() const;
    void queueFrame(const RS485Frame& frame, bool dryRun = false);
    void process();
    void flush();

    void setOnSend(std::function<void(const RS485Frame&, bool)> cb);

  private:
    HardwareSerial& serial_;
    int dePin_{-1};
    int rePin_{-1};
    bool allowTransmit_{false};
    std::queue<RS485Frame> txQueue_;
    std::queue<bool> dryRunQueue_;
    std::function<void(const RS485Frame&, bool)> onSend_;

    void setDriverEnable(bool enabled);
};

