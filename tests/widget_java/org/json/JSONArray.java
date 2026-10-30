package org.json;

import java.util.ArrayList;
import java.util.List;

/** 시험용 org.json(WidgetData·RouteMap 이 쓰는 것만). 안드로이드에서는 기기의 org.json 을 쓴다 */
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

    public boolean isNull(int i) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        return v == null || v == JSONObject.NULL;
    }

    public String optString(int i, String fallback) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        if (v == null || v == JSONObject.NULL) return fallback;
        if (v instanceof Double) {
            double d = (Double) v;
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }
        return String.valueOf(v);
    }

    public int optInt(int i, int fallback) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        return v instanceof Double ? (int) (double) (Double) v : fallback;
    }

    public double optDouble(int i, double fallback) {
        Object v = i >= 0 && i < values.size() ? values.get(i) : null;
        return v instanceof Double ? (Double) v : fallback;
    }
}
