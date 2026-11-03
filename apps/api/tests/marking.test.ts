import { fixedOptions, questionTypes } from "@ieltiva/shared";
import { describe, expect, it } from "vitest";
import { countWords, detectAudioType, markQuestion, normalizeAnswer, type MarkableQuestion } from "../src/services/exam/marking.js";

const key = (acceptedValue: string, extra: Partial<MarkableQuestion["answers"][number]> = {}) => ({ acceptedValue, caseSensitive: false, ignorePunctuation: true, maxWords: null, ...extra });
const text = (type: string, answers: MarkableQuestion["answers"], marks = 1): MarkableQuestion => ({ type, marks, scoringMode: "ALL_OR_NOTHING", hasOptions: false, answers });
const choice = (type: string, answers: string[], marks = 1, scoringMode: MarkableQuestion["scoringMode"] = "ALL_OR_NOTHING"): MarkableQuestion => ({ type, marks, scoringMode, hasOptions: true, answers: answers.map((value) => key(value)) });

describe("answer normalization", () => {
  it("ignores case, extra spaces and surrounding punctuation by default", () => {
    expect(normalizeAnswer("  The   LIBRARY. ")).toBe("the library");
  });
  it("makes curly quotes, long dashes and full-width characters comparable", () => {
    expect(normalizeAnswer("student’s")).toBe("student's");
    expect(normalizeAnswer("part–time")).toBe("part-time");
    expect(normalizeAnswer("１２")).toBe("12");
  });
  it("can keep case and punctuation when a question needs them", () => {
    expect(normalizeAnswer("Dr. Smith.", { caseSensitive: true, ignorePunctuation: false })).toBe("Dr. Smith.");
  });
  it("keeps punctuation inside an answer", () => {
    expect(normalizeAnswer("10:30.")).toBe("10:30");
  });
  it("counts words across any spacing", () => {
    expect(countWords("  two \n words ")).toBe(2);
    expect(countWords("   ")).toBe(0);
  });
});

describe("typed answers", () => {
  const completion = ["SENTENCE_COMPLETION", "SUMMARY_COMPLETION", "NOTE_COMPLETION", "TABLE_COMPLETION", "FLOW_CHART_COMPLETION", "FORM_COMPLETION", "DIAGRAM_LABELLING", "PLAN_LABELLING", "MAP_LABELLING", "SHORT_ANSWER"];

  it.each(completion)("%s accepts any listed alternative and rejects other text", (type) => {
    const question = text(type, [key("car park"), key("parking lot")]);
    expect(markQuestion(question, { text: "PARKING  lot." }).isCorrect).toBe(true);
    expect(markQuestion(question, { text: "Car Park" }).marksAwarded).toBe(1);
    expect(markQuestion(question, { text: "garage" }).isCorrect).toBe(false);
  });

  it("doesn't count an answer that goes over the word limit", () => {
    const question = text("SENTENCE_COMPLETION", [key("old town", { maxWords: 2 }), key("the old town", { maxWords: 2 })]);
    expect(markQuestion(question, { text: "old town" }).isCorrect).toBe(true);
    expect(markQuestion(question, { text: "the old town" }).isCorrect).toBe(false);
  });

  it("respects case sensitivity when the key asks for it", () => {
    const question = text("SHORT_ANSWER", [key("NASA", { caseSensitive: true })]);
    expect(markQuestion(question, { text: "NASA" }).isCorrect).toBe(true);
    expect(markQuestion(question, { text: "nasa" }).isCorrect).toBe(false);
  });

  it("never treats an empty answer as correct", () => {
    expect(markQuestion(text("SHORT_ANSWER", [key("...")]), { text: "..." }).isCorrect).toBe(false);
    expect(markQuestion(text("SHORT_ANSWER", [key("x")]), { text: "   " }).isCorrect).toBe(false);
    expect(markQuestion(text("SHORT_ANSWER", [key("x")]), null).marksAwarded).toBe(0);
  });

  it("rejects a response in the wrong shape", () => {
    expect(markQuestion(text("SHORT_ANSWER", [key("x")]), { selected: ["x"] }).isCorrect).toBe(false);
  });
});

describe("choice answers", () => {
  const single = ["MULTIPLE_CHOICE_SINGLE", "TRUE_FALSE_NOT_GIVEN", "YES_NO_NOT_GIVEN", "MATCHING_GENERAL", "MATCHING_HEADINGS", "MATCHING_INFORMATION", "MATCHING_FEATURES", "MATCHING_SENTENCE_ENDINGS"];

  it.each(single)("%s needs exactly the correct option", (type) => {
    const question = choice(type, ["B"]);
    expect(markQuestion(question, { selected: ["B"] }).isCorrect).toBe(true);
    expect(markQuestion(question, { selected: ["A"] }).isCorrect).toBe(false);
    expect(markQuestion(question, { selected: ["A", "B"] }).isCorrect).toBe(false);
    expect(markQuestion(question, { selected: [] }).isCorrect).toBe(false);
    expect(markQuestion(question, { text: "B" }).isCorrect).toBe(false);
  });

  it("labelling questions with options mark as a choice", () => {
    const question = choice("MAP_LABELLING", ["C"]);
    expect(markQuestion(question, { selected: ["C"] }).isCorrect).toBe(true);
  });

  it("all-or-nothing needs every option, and no extras", () => {
    const question = choice("MULTIPLE_CHOICE_MULTI", ["A", "C"], 2);
    expect(markQuestion(question, { selected: ["C", "A"] })).toEqual({ isCorrect: true, marksAwarded: 2 });
    expect(markQuestion(question, { selected: ["A"] })).toEqual({ isCorrect: false, marksAwarded: 0 });
    expect(markQuestion(question, { selected: ["A", "B", "C"] })).toEqual({ isCorrect: false, marksAwarded: 0 });
  });

  it("per-item scoring gives partial marks, and selecting everything earns nothing", () => {
    const question = choice("MULTIPLE_CHOICE_MULTI", ["A", "C"], 2, "PER_ITEM");
    expect(markQuestion(question, { selected: ["A", "C"] })).toEqual({ isCorrect: true, marksAwarded: 2 });
    expect(markQuestion(question, { selected: ["A", "B"] })).toEqual({ isCorrect: false, marksAwarded: 1 });
    expect(markQuestion(question, { selected: ["A", "B", "C"] })).toEqual({ isCorrect: false, marksAwarded: 0 });
    expect(markQuestion(question, { selected: ["A", "A"] })).toEqual({ isCorrect: false, marksAwarded: 1 });
  });
});

describe("question type coverage", () => {
  it("every question type in the system is handled by these tests", () => {
    expect(questionTypes).toHaveLength(19);
    expect(fixedOptions.TRUE_FALSE_NOT_GIVEN).toEqual(["TRUE", "FALSE", "NOT GIVEN"]);
    expect(fixedOptions.YES_NO_NOT_GIVEN).toEqual(["YES", "NO", "NOT GIVEN"]);
  });
});

describe("audio file checks", () => {
  it("recognises real audio headers", () => {
    expect(detectAudioType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))?.extension).toBe("webm");
    expect(detectAudioType(Buffer.from("OggS\0\0"))?.extension).toBe("ogg");
    expect(detectAudioType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))?.extension).toBe("wav");
  });
  it("rejects anything else, whatever it's called", () => {
    expect(detectAudioType(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
});
