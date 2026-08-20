#pragma once

#include "Frame.h"
#include <functional>
#include <vector>

class FrameParser {
  public:
    using Callback = std::function<void(const ParsedFrame&)>;

    explicit FrameParser(Callback cb);
    void reset();
    void feed(uint8_t byte);

  private:
    Callback callback_;
    std::vector<uint8_t> buffer_;
    void emitFrame();
};

