#include "SignatureVerifier.h"

#include <mbedtls/md.h>
#include <time.h>

namespace {
constexpr int64_t kReplayWindowMs = 5LL * 60LL * 1000LL;
constexpr uint64_t kMinValidEpoch = 1600000000ULL;

String toHex(const uint8_t* data, size_t length) {
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    char buffer[3];
    snprintf(buffer, sizeof(buffer), "%02x", data[i]);
    out += buffer;
  }
  return out;
}

String sha256Hex(const String& input) {
  uint8_t digest[32];
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
             reinterpret_cast<const unsigned char*>(input.c_str()), input.length(), digest);
  return toHex(digest, sizeof(digest));
}

String hmacSha256Hex(const String& key, const String& message) {
  uint8_t digest[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                  reinterpret_cast<const unsigned char*>(key.c_str()), key.length(),
                  reinterpret_cast<const unsigned char*>(message.c_str()), message.length(), digest);
  return toHex(digest, sizeof(digest));
}

bool constantTimeEquals(const String& a, const String& b) {
  if (a.length() != b.length()) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < a.length(); i++) diff |= (uint8_t)a[i] ^ (uint8_t)b[i];
  return diff == 0;
}
}  // namespace

bool SignatureVerifier::verify(const String& method, const String& path, const String& body,
                               const String& timestampHeader, const String& signatureHeader,
                               String& error) const {
  if (!enabled()) return true;
  if (timestampHeader.length() == 0 || !signatureHeader.startsWith("v1:")) {
    error = "Signatur fehlt";
    return false;
  }
  // Replay protection only when we actually know the time (spec/signing.md).
  if ((uint64_t)time(nullptr) > kMinValidEpoch) {
    int64_t nowMs = (int64_t)time(nullptr) * 1000LL;
    int64_t requestMs = strtoll(timestampHeader.c_str(), nullptr, 10);
    int64_t age = nowMs - requestMs;
    if (age < 0) age = -age;
    if (requestMs == 0 || age > kReplayWindowMs) {
      error = "Signatur abgelaufen";
      return false;
    }
  }
  String canonical = "v1\n" + timestampHeader + "\n" + method + "\n" + path + "\n" + sha256Hex(body);
  String expected = "v1:" + hmacSha256Hex(secret_, canonical);
  if (!constantTimeEquals(expected, signatureHeader)) {
    error = "Signatur ungültig";
    return false;
  }
  return true;
}
