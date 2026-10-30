package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 시험용 org.json(WidgetData·RouteMap 이 쓰는 것만): 작은 JSON 읽기와 opt*. 안드로이드에서는 기기의 org.json 을 쓴다(뜻은 같게: opt* 는 없거나 꼴이 다르면 기본값).
 */
public class JSONObject {
    public static final Object NULL = new Object();
    final Map<String, Object> map = new LinkedHashMap<>();

    JSONObject() {}

    public JSONObject(String json) throws JSONException {
        Reader r = new Reader(json);
        Object v = r.value();
        r.space();
        if (!(v instanceof JSONObject) || r.at < r.s.length()) throw new JSONException("not an object");
        map.putAll(((JSONObject) v).map);
    }

    public boolean isNull(String key) {
        Object v = map.get(key);
        return v == null || v == NULL;
    }

    public int optInt(String key, int fallback) {
        Object v = map.get(key);
        if (v instanceof Double) return (int) (double) (Double) v;
        if (v instanceof String) {
            try {
                return (int) Double.parseDouble((String) v);
            } catch (NumberFormatException e) {
                return fallback;
            }
        }
        return fallback;
    }

    public String optString(String key) {
        return optString(key, "");
    }

    public String optString(String key, String fallback) {
        Object v = map.get(key);
        if (v == null || v == NULL) return fallback;
        if (v instanceof Double) {
            double d = (Double) v;
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }
        return String.valueOf(v);
    }

    public JSONArray optJSONArray(String key) {
        Object v = map.get(key);
        return v instanceof JSONArray ? (JSONArray) v : null;
    }

    public JSONObject optJSONObject(String key) {
        Object v = map.get(key);
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    public boolean has(String key) {
        return map.containsKey(key);
    }

    public java.util.Iterator<String> keys() {
        return map.keySet().iterator();
    }

    @Override
    public String toString() {
        return map.toString();
    }

    /** 아주 작은 JSON 읽기(문자열 이스케이프·숫자·true/false/null) */
    static final class Reader {
        final String s;
        int at;

        Reader(String s) {
            this.s = s;
        }

        void space() {
            while (at < s.length() && Character.isWhitespace(s.charAt(at))) at++;
        }

        JSONException bad() {
            return new JSONException("bad json at " + at);
        }

        Object value() throws JSONException {
            space();
            if (at >= s.length()) throw bad();
            char ch = s.charAt(at);
            if (ch == '{') return object();
            if (ch == '[') return array();
            if (ch == '"') return string();
            if (s.startsWith("true", at)) { at += 4; return Boolean.TRUE; }
            if (s.startsWith("false", at)) { at += 5; return Boolean.FALSE; }
            if (s.startsWith("null", at)) { at += 4; return NULL; }
            int start = at;
            while (at < s.length() && "+-0123456789.eE".indexOf(s.charAt(at)) >= 0) at++;
            if (start == at) throw bad();
            try {
                return Double.parseDouble(s.substring(start, at));
            } catch (NumberFormatException e) {
                throw bad();
            }
        }

        JSONObject object() throws JSONException {
            JSONObject o = new JSONObject();
            at++;
            space();
            if (at < s.length() && s.charAt(at) == '}') { at++; return o; }
            while (true) {
                space();
                if (at >= s.length() || s.charAt(at) != '"') throw bad();
                String key = string();
                space();
                if (at >= s.length() || s.charAt(at) != ':') throw bad();
                at++;
                o.map.put(key, value());
                space();
                if (at >= s.length()) throw bad();
                char ch = s.charAt(at++);
                if (ch == '}') return o;
                if (ch != ',') throw bad();
            }
        }

        JSONArray array() throws JSONException {
            JSONArray a = new JSONArray();
            at++;
            space();
            if (at < s.length() && s.charAt(at) == ']') { at++; return a; }
            while (true) {
                a.values.add(value());
                space();
                if (at >= s.length()) throw bad();
                char ch = s.charAt(at++);
                if (ch == ']') return a;
                if (ch != ',') throw bad();
            }
        }

        String string() throws JSONException {
            StringBuilder out = new StringBuilder();
            at++;
            while (at < s.length()) {
                char ch = s.charAt(at++);
                if (ch == '"') return out.toString();
                if (ch != '\\') { out.append(ch); continue; }
                if (at >= s.length()) throw bad();
                char e = s.charAt(at++);
                switch (e) {
                    case 'n': out.append('\n'); break;
                    case 't': out.append('\t'); break;
                    case 'r': out.append('\r'); break;
                    case 'b': out.append('\b'); break;
                    case 'f': out.append('\f'); break;
                    case 'u':
                        if (at + 4 > s.length()) throw bad();
                        out.append((char) Integer.parseInt(s.substring(at, at + 4), 16));
                        at += 4;
                        break;
                    default: out.append(e);
                }
            }
            throw bad();
        }
    }
}
