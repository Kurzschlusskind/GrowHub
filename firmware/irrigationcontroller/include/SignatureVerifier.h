#pragma once

#include <Arduino.h>

// Verifies HMAC-SHA256 request signatures (spec/signing.md):
//   canonical = "v1\n<timestamp>\n<METHOD>\n<pathname>\n<sha256hex(body)>"
//   X-GrowHub-Signature: v1:<hmac_sha256_hex(secret, canonical)>
// Disabled when no secret is configured. The replay window is only enforced
// while the device has a valid clock.
class SignatureVerifier {
 public:
  void begin(const String& secret) { secret_ = secret; }
  bool enabled() const { return secret_.length() > 0; }

  // Returns true if the request may proceed; otherwise `error` is set.
  bool verify(const String& method, const String& path, const String& body,
              const String& timestampHeader, const String& signatureHeader,
              String& error) const;

 private:
  String secret_;
};
