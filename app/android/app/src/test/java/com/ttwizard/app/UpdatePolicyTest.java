package com.ttwizard.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 앱 안 업데이트를 스스로 묻는 규칙(update118): 같은 판은 하루 한 번, '나중에' 뒤 3일 쉼 */
public class UpdatePolicyTest {

    private static final long NOW = 1_800_000_000_000L;
    private static final long HOUR = 60L * 60 * 1000;

    @Test
    public void asksWhenNothingRecorded() {
        assertTrue(UpdatePolicy.shouldAsk(NOW, 118, 0, 0, 0));
    }

    @Test
    public void noUpdateNoAsk() {
        assertFalse(UpdatePolicy.shouldAsk(NOW, 0, 0, 0, 0));
        assertFalse(UpdatePolicy.shouldAsk(NOW, -1, 0, 0, 0));
    }

    @Test
    public void sameVersionOncePerDay() {
        assertFalse(UpdatePolicy.shouldAsk(NOW, 118, 118, NOW - 23 * HOUR, 0));
        assertTrue(UpdatePolicy.shouldAsk(NOW, 118, 118, NOW - 25 * HOUR, 0));
    }

    @Test
    public void newerVersionAsksAgainSameDay() {
        assertTrue(UpdatePolicy.shouldAsk(NOW, 119, 118, NOW - HOUR, 0));
    }

    @Test
    public void restsThreeDaysAfterDecline() {
        assertFalse(UpdatePolicy.shouldAsk(NOW, 119, 118, NOW - 2 * 24 * HOUR, NOW - 2 * 24 * HOUR));
        assertFalse(UpdatePolicy.shouldAsk(NOW, 119, 118, NOW - 71 * HOUR, NOW - 71 * HOUR));
        assertTrue(UpdatePolicy.shouldAsk(NOW, 119, 118, NOW - 73 * HOUR, NOW - 73 * HOUR));
    }

    @Test
    public void clockMovedBackDoesNotBlockForever() {
        assertTrue(UpdatePolicy.shouldAsk(NOW, 118, 118, NOW + 10 * 24 * HOUR, 0));
        assertTrue(UpdatePolicy.shouldAsk(NOW, 118, 0, 0, NOW + 10 * 24 * HOUR));
    }
}
