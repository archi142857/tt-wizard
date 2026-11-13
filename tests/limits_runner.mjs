// tests/test_limits.py 가 부른다: 수강 제한 태그 고르기(web/js/limits.js)를 사례마다 돌려 JSON 으로 낸다.
import { readFileSync } from "node:fs";
import {
  studentFrom, sectionTag, courseTag, limitOf, sourceText, scheduleSourceText, kstToday, noticeFor, check,
} from "../web/js/limits.js";

const [, , casesPath] = process.argv;
const cases = JSON.parse(readFileSync(casesPath, "utf8"));

const out = cases.map((c) => {
  switch (c.kind) {
    case "tag": {
      const student = studentFrom(c.profile, c.catalog);
      return sectionTag(c.rule, student, { today: c.today ?? null, schedule: c.schedule ?? null });
    }
    case "check":
      return check(c.allow, studentFrom(c.profile, c.catalog));
    case "course":
      return courseTag(c.results);
    case "lookup":
      return limitOf(c.data, c.course, c.section, c.term ?? null);
    case "text":
      return { source: sourceText(c.data), schedule: scheduleSourceText(c.data), notice: noticeFor(c.results || []) };
    case "today":
      return kstToday(new Date(c.now));
    case "student":
      return studentFrom(c.profile, c.catalog);
    default:
      throw new Error(`모르는 사례 ${c.kind}`);
  }
});
process.stdout.write(JSON.stringify(out));
