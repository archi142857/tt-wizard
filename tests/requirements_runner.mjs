// tests/test_requirements.py 가 부른다: 졸업 요건·성적·학기 학점 계산(web/js/requirements.js)을 사례마다 돌려 JSON 으로 낸다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pickVersion, pickVersionFor, buildSameCourse, tidyRecords, evaluateProgram, creditSummary, gpa, gradeNeeded,
  termCreditLimit, withinLimit, isMajorCourse, suggestCourses, rankSuggestions,
} from "../web/js/requirements.js";
import { gapFit, parseCourses, TravelMatrix } from "../web/js/engine.js";

const [, , dataDir, casesPath] = process.argv;
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const common = read(join(dataDir, "common.json"));
const courseMap = read(join(dataDir, "course_map.json"));
const program = (p) => (typeof p === "string" ? read(join(dataDir, "programs", `${p}.json`)) : p);

const matrix = (c) => new TravelMatrix({ table: new Map(Object.entries(c.table || {})), buildings: {}, defaultMinutes: c.defaultMinutes ?? 10 });
const sections = (json) => parseCourses({ courses: json || [] }).flatMap((x) => x.sections);

const out = read(casesPath).map((c) => {
  switch (c.kind) {
    case "pick": {
      const { version, reason } = pickVersion(program(c.program), c.entryYear);
      return version ? version.entry_years : reason;
    }
    case "pickfor": {
      const { version, reason } = pickVersionFor(program(c.program), c.who);
      return version ? version.entry_years : reason;
    }
    case "same": {
      const same = buildSameCourse(courseMap, []);
      return c.codes.map(same);
    }
    case "tidy": {
      const t = tidyRecords(c.records);
      return { courses: t.courses.map((x) => [x.code, x.term, x.earned]), replaced: t.replaced.map((x) => [x.code, x.term]),
        duplicates: t.duplicates, dropped: t.dropped.map((x) => [x.code, x.why || "W"]) };
    }
    case "evaluate": {
      const p = program(c.program);
      const { version } = pickVersion(p, c.entryYear);
      const same = buildSameCourse(courseMap, [p]);
      const t = tidyRecords(c.records, same);
      const rows = evaluateProgram(p, version, t.courses, { role: c.role, sameCourse: same });
      return Object.fromEntries(rows.map((r) => [r.id, { state: r.state, reason: r.reason || null, have: r.have.count,
        missing: (r.missing || []).map((m) => m.code) }]));
    }
    case "credits": {
      const picks = c.picks.map((x) => {
        const p = program(x.program);
        return { program: p, version: pickVersion(p, x.entryYear).version, role: x.role };
      });
      const t = tidyRecords(c.records);
      const s = creditSummary(t.courses, picks, { rules: common });
      return { total: s.total, ge: s.ge, teaching: s.teaching, general: s.general, majors: s.majors, shared: s.shared,
        minorShared: s.minorShared, overlap: s.overlap, outsideOver: s.outsideOver };
    }
    case "major": {
      const p = program(c.program);
      const { version } = pickVersion(p, c.entryYear);
      return c.courses.map((x) => isMajorCourse(x, p, version));
    }
    case "gpa": {
      const g = gpa(c.records, c.majorCodes ? { isMajor: (x) => c.majorCodes.includes(x.code) } : {});
      return { all: g.all, major: g.major, byTerm: g.byTerm, lastTwoRegular: g.lastTwoRegular, ungraded: g.ungraded,
        graduation: g.graduation };
    }
    case "need":
      return gradeNeeded(c.current, c.planned, c.target);
    case "limit": {
      const lim = termCreditLimit(common.term_limit, c.who);
      const res = { limit: lim.limit, base: lim.base };
      if (c.courses) res.within = withinLimit(c.courses, lim);
      return res;
    }
    case "gapfit": {
      const g = gapFit(sections(c.base), parseCourses({ courses: c.courses }), matrix(c), c.home || "H", { rules: c.rules || null });
      return { base: g.base, blocked: g.blocked, fits: g.fits.map((f) => [f.course.id, f.section.no, f.add, f.unknownRoom, f.atRisk]) };
    }
    case "suggest": {
      const p = program(c.program);
      const { version } = pickVersion(p, c.entryYear);
      const same = buildSameCourse(courseMap, [p]);
      const t = tidyRecords(c.records, same);
      const rows = evaluateProgram(p, version, t.courses, { role: c.role, sameCourse: same });
      const next = parseCourses({ courses: c.courses });
      const sug = suggestCourses([{ program: p, rows }], next, { sameCourse: same });
      const fit = c.fit ? gapFit(sections(c.base), sug.map((x) => x.course), matrix(c), "H") : null;
      return { suggestions: sug.map((x) => [x.course.id, x.strength, x.reasons.map((r) => r.row)]),
        ranked: rankSuggestions(sug, fit).map((x) => [x.course.id, x.strength, x.fit ? x.fit.add.cost : null]) };
    }
    default:
      return { error: `모르는 사례 ${c.kind}` };
  }
});
console.log(JSON.stringify(out));
