#include <Arduino.h>
#include <unity.h>

#include "CalibrationMapping.h"
#include "Frame.h"
#include "FrameParser.h"

static ParsedFrame lastParsed;
static bool parsedReceived = false;

void setUp() {
    lastParsed = ParsedFrame();
    parsedReceived = false;
}

void tearDown() {}

void test_mapping_defaults() {
    CalibrationMapping mapping;
    TEST_ASSERT_EQUAL_UINT8(0x26, mapping.evaluate(25.0f));
    TEST_ASSERT_EQUAL_UINT8(0x3F, mapping.evaluate(50.0f));
    TEST_ASSERT_EQUAL_UINT8(0x56, mapping.evaluate(73.0f));
    TEST_ASSERT_EQUAL_UINT8(0x64, mapping.evaluate(100.0f));
}

void test_mapping_identity() {
    CalibrationMapping mapping;
    mapping.setIdentity(true);
    TEST_ASSERT_EQUAL_UINT8(0, mapping.evaluate(0));
    TEST_ASSERT_EQUAL_UINT8(255, mapping.evaluate(100));
}

void test_frame_checksum() {
    std::array<uint8_t, 5> channels{{0x3F, 0x26, 0x00, 0x00, 0x00}};
    RS485Frame frame = makeFrameFromChannels(channels);
    TEST_ASSERT_EQUAL_UINT8(0x65, frame.sumByte);
    auto bytes = frame.toBytes();
    TEST_ASSERT_EQUAL_UINT8(0xF1, bytes[0]);
    TEST_ASSERT_EQUAL_UINT8(0xE2, bytes[1]);
    TEST_ASSERT_EQUAL_UINT8(0xF3, bytes.back());
}

void test_parser_full_frame() {
    FrameParser parser([](const ParsedFrame& parsed) {
        lastParsed = parsed;
        parsedReceived = true;
    });

    uint8_t frameBytes[] = {0xF1, 0xE2, 0x3F, 0x26, 0x00, 0x00, 0x00, 0x65, 0xF3};
    for (uint8_t b : frameBytes) {
        parser.feed(b);
    }
    TEST_ASSERT_TRUE(parsedReceived);
    TEST_ASSERT_TRUE(lastParsed.sumValid);
    TEST_ASSERT_TRUE(lastParsed.hadHeader);
    TEST_ASSERT_EQUAL_UINT8(0x3F, lastParsed.channels[0]);
    TEST_ASSERT_EQUAL_UINT8(0x26, lastParsed.channels[1]);
}

void test_parser_short_frame() {
    FrameParser parser([](const ParsedFrame& parsed) {
        lastParsed = parsed;
        parsedReceived = true;
    });

    uint8_t shortBytes[] = {0x00, 0x00, 0x00, 0x26, 0xF3};
    for (uint8_t b : shortBytes) {
        parser.feed(b);
    }
    TEST_ASSERT_TRUE(parsedReceived);
    TEST_ASSERT_FALSE(lastParsed.hadHeader);
    TEST_ASSERT_TRUE(lastParsed.isShort);
    TEST_ASSERT_EQUAL_UINT8(0x00, lastParsed.channels[0]);
    TEST_ASSERT_EQUAL_UINT8(0x00, lastParsed.channels[1]);
    TEST_ASSERT_EQUAL_UINT8(0x00, lastParsed.channels[2]);
    TEST_ASSERT_EQUAL_UINT8(0x26, lastParsed.receivedSum);
}

void setup() {
    delay(2000);
    UNITY_BEGIN();
    RUN_TEST(test_mapping_defaults);
    RUN_TEST(test_mapping_identity);
    RUN_TEST(test_frame_checksum);
    RUN_TEST(test_parser_full_frame);
    RUN_TEST(test_parser_short_frame);
    UNITY_END();
}

void loop() {}

