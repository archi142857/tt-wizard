package com.ttwizard.app;

/**
 * 앱 안 업데이트를 물어도 되는지(update118, UpdatePlugin). update154 부터 묻는 것은 화면의 우리 팝업이고(상태의 ask), 기록은 화면이
 * 팝업을 띄울 때(shown: askedCode·askedAt)와 [닫기]·뒤로 가기(later: declinedAt). 안드로이드에 기대지 않아 JUnit 으로 본다(UpdatePolicyTest).
 *   - 같은 판(Play 에 있는 새 versionCode)은 하루에 한 번만 묻는다.
 *   - 사용자가 '나중에'(닫기 포함)를 고르면 어느 판이든 3일 동안 다시 묻지 않는다.
 *   - 기기 시계가 거꾸로 갔으면(지난 기록이 앞날) 그 기록은 없는 것으로 본다(영영 안 묻는 일이 없게).
 * TTW_APP.appUpdate.start(Play 의 업데이트 창을 바로 띄운다)는 이 규칙을 타지 않는다: 화면이 사용자가 직접 누를 때만 부른다.
 */
final class UpdatePolicy {

    static final long DAY_MS = 24L * 60 * 60 * 1000;
    /** 같은 판을 다시 물을 때까지 */
    static final long ASK_AGAIN_MS = DAY_MS;
    /** '나중에' 뒤 쉬는 동안 */
    static final long REST_AFTER_DECLINE_MS = 3 * DAY_MS;

    private UpdatePolicy() {}

    /**
     * @param now        지금(System.currentTimeMillis)
     * @param available  Play 에 있는 새 판의 versionCode(없으면 0 이하)
     * @param askedCode  마지막으로 물은 판(없으면 0)
     * @param askedAt    마지막으로 물은 때(없으면 0)
     * @param declinedAt 마지막으로 '나중에'를 고른 때(없으면 0)
     */
    static boolean shouldAsk(long now, int available, int askedCode, long askedAt, long declinedAt) {
        if (available <= 0) return false;
        if (declinedAt > 0 && declinedAt <= now && now - declinedAt < REST_AFTER_DECLINE_MS) return false;
        if (askedCode == available && askedAt > 0 && askedAt <= now && now - askedAt < ASK_AGAIN_MS) return false;
        return true;
    }
}
