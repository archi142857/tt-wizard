// tests/test_calendar.py 가 부른다: 캘린더 파일(web/js/ics.js)을 사례마다 만들어 JSON 으로 낸다.
import { readFileSync } from "node:fs";
import { buildIcs, escapeText, fold, icsFileName, itemsFromSections, placeOf, termInfo, termLabel, termRangeLabel } from "../web/js/ics.js";
import { parseCourses } from "../web/js/engine.js";

const [, , calendarPath, casesPath] = process.argv;
const calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
const out = JSON.parse(readFileSync(casesPath, "utf8")).map((c) => {
  switch (c.kind) {
    case "build": {
      const info = c.calendar ? termInfo(c.calendar, c.term) : termInfo(calendar, c.term);
      if (!info) return { error: "no_term" };
      const sections = parseCourses({ courses: c.courses }).flatMap((x) => x.sections);
      const r = buildIcs(itemsFromSections(sections).concat(c.items || []), info, { now: new Date(c.now || "2026-11-13T00:00:00Z"), name: c.name || null });
      return { text: r.text, events: r.events, skipped: r.skipped };
    }
    case "text":
      return { esc: c.values.map(escapeText), fold: c.lines.map(fold), place: c.places.map(placeOf), file: icsFileName(c.term, c.title),
        plain: icsFileName(c.term), labels: ["2026-1", "2026-S", "2026-W", "x"].map(termLabel),
        range: termRangeLabel(termInfo(calendar, c.term)), none: termRangeLabel(termInfo(calendar, "2027-1")) };
    default:
      return { error: `모르는 사례 ${c.kind}` };
  }
});
console.log(JSON.stringify(out));
