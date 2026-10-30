package org.json;

import java.util.ArrayList;
import java.util.List;

/** 시험용 org.json(WidgetData 가 쓰는 것만). 안드로이드에서는 기기의 org.json 을 쓴다 */
public class JSONArray {
    final List<Object> values = new ArrayList<>();

    public int length() {
        return values.size();
    }

    public JSONObject optJSONObject(int i) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    public JSONArray optJSONArray(int i) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        return v instanceof JSONArray ? (JSONArray) v : null;
    }
}
