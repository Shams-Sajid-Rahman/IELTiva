import { questionTypes, type AnswerResponse } from "@ieltiva/shared";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasAnswer, QuestionGroupView, type AnswerEntry } from "@/features/exam/question-renderer";
import { Recorder } from "@/features/exam/recorder";
import type { GroupView } from "@/features/exam/types";
import { useAutosave } from "@/features/exam/use-autosave";
import { ApiRequestError } from "@/lib/api-client";
import { axeViolations, renderUi } from "./render";

const options = [{ id: "o1", label: "A", body: "First" }, { id: "o2", label: "B", body: "Second" }, { id: "o3", label: "C", body: "Third" }];
const fixed = [{ id: "o1", label: "TRUE", body: "TRUE" }, { id: "o2", label: "FALSE", body: "FALSE" }, { id: "o3", label: "NOT GIVEN", body: "NOT GIVEN" }];

const OPTION_SETS: Record<string, typeof options> = {
  MULTIPLE_CHOICE_SINGLE: options,
  MULTIPLE_CHOICE_MULTI: options,
  TRUE_FALSE_NOT_GIVEN: fixed,
  YES_NO_NOT_GIVEN: fixed,
  MATCHING_GENERAL: options,
  MATCHING_HEADINGS: options,
  MATCHING_INFORMATION: options,
  MATCHING_FEATURES: options,
  MATCHING_SENTENCE_ENDINGS: options,
  MAP_LABELLING: options,
};

function group(type: string, withOptions = OPTION_SETS[type] ?? []): GroupView {
  return { id: `g-${type}`, position: 1, type, instructions: "Do this.", stimulus: null, hasImage: false, questions: [{ id: "q1", number: 1, prompt: "Question text", marks: 1, options: withOptions }] };
}

function Harness({ view }: { view: GroupView }) {
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>({});
  return (
    <>
      <QuestionGroupView group={view} answers={answers} onAnswer={(id, response) => setAnswers((all) => ({ ...all, [id]: { response, isFlagged: false } }))} onFlag={() => {}} />
      <output data-testid="value">{JSON.stringify(answers.q1?.response ?? null)}</output>
    </>
  );
}
const value = () => JSON.parse(screen.getByTestId("value").textContent ?? "null") as AnswerResponse | null;

describe("question renderer", () => {
  it.each(["MULTIPLE_CHOICE_SINGLE", "TRUE_FALSE_NOT_GIVEN", "YES_NO_NOT_GIVEN"])("%s uses radio buttons", async (type) => {
    const user = userEvent.setup();
    const { container } = renderUi(<Harness view={group(type)} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    await user.click(radios[1]!);
    expect(value()).toEqual({ selected: [OPTION_SETS[type]![1]!.label] });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("multiple answers use checkboxes that add and remove", async () => {
    const user = userEvent.setup();
    const { container } = renderUi(<Harness view={group("MULTIPLE_CHOICE_MULTI")} />);
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[0]!);
    await user.click(boxes[2]!);
    expect(value()).toEqual({ selected: ["A", "C"] });
    await user.click(boxes[0]!);
    expect(value()).toEqual({ selected: ["C"] });
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each(["MATCHING_GENERAL", "MATCHING_HEADINGS", "MATCHING_INFORMATION", "MATCHING_FEATURES", "MATCHING_SENTENCE_ENDINGS", "MAP_LABELLING"])("%s uses a labelled list of options", async (type) => {
    const user = userEvent.setup();
    const { container } = renderUi(<Harness view={group(type)} />);
    await user.selectOptions(screen.getByRole("combobox", { name: /Question text/ }), "B");
    expect(value()).toEqual({ selected: ["B"] });
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each(["SENTENCE_COMPLETION", "SUMMARY_COMPLETION", "NOTE_COMPLETION", "TABLE_COMPLETION", "FLOW_CHART_COMPLETION", "FORM_COMPLETION", "DIAGRAM_LABELLING", "PLAN_LABELLING", "MAP_LABELLING", "SHORT_ANSWER"])("%s without options uses a labelled text box", async (type) => {
    const user = userEvent.setup();
    const { container } = renderUi(<Harness view={group(type, [])} />);
    await user.type(screen.getByRole("textbox", { name: /Question text/ }), "library");
    expect(value()).toEqual({ text: "library" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("covers every question type the system supports", () => {
    const covered = new Set(["MULTIPLE_CHOICE_SINGLE", "TRUE_FALSE_NOT_GIVEN", "YES_NO_NOT_GIVEN", "MULTIPLE_CHOICE_MULTI", "MATCHING_GENERAL", "MATCHING_HEADINGS", "MATCHING_INFORMATION", "MATCHING_FEATURES", "MATCHING_SENTENCE_ENDINGS", "MAP_LABELLING", "SENTENCE_COMPLETION", "SUMMARY_COMPLETION", "NOTE_COMPLETION", "TABLE_COMPLETION", "FLOW_CHART_COMPLETION", "FORM_COMPLETION", "DIAGRAM_LABELLING", "PLAN_LABELLING", "SHORT_ANSWER"]);
    expect(questionTypes.filter((type) => !covered.has(type))).toEqual([]);
  });

  it("shows tables and flow charts, and a flag control", () => {
    renderUi(<QuestionGroupView group={{ ...group("TABLE_COMPLETION", []), stimulus: { headers: ["Year", "Value"], rows: [["2005", "58%"]], steps: ["First step", "Second step"] } }} answers={{}} onAnswer={() => {}} onFlag={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Year" })).toBeInTheDocument();
    expect(screen.getByText("Second step")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flag question 1" })).toHaveAttribute("aria-pressed", "false");
  });

  it("knows what counts as answered", () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer({ response: { text: "  " }, isFlagged: false })).toBe(false);
    expect(hasAnswer({ response: { selected: [] }, isFlagged: true })).toBe(false);
    expect(hasAnswer({ response: { text: "x" }, isFlagged: false })).toBe(true);
    expect(hasAnswer({ response: { selected: ["A"] }, isFlagged: false })).toBe(true);
  });
});

describe("autosave", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const setup = (save: (changes: Record<string, string>) => Promise<unknown>, onClosed = vi.fn()) => renderHook(() => useAutosave<string>({ storageKey: "k", save, onClosed, debounceMs: 1000 }));

  it("waits, then sends many quick changes as one save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => {
      result.current.queue("a", "1");
      result.current.queue("a", "12");
      result.current.queue("b", "x");
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: "12", b: "x" });
    expect(result.current.status).toBe("saved");
    expect(sessionStorage.getItem("k")).toBeNull();
  });

  it("keeps unsaved work when offline, retries, and newer changes win", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiRequestError(0, "NETWORK_ERROR", "offline")).mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => result.current.queue("a", "old"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(result.current.status).toBe("offline");
    expect(JSON.parse(sessionStorage.getItem("k")!)).toEqual({ a: "old" });
    act(() => result.current.queue("a", "new"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(save).toHaveBeenLastCalledWith({ a: "new" });
    expect(result.current.status).toBe("saved");
  });

  it("recovers unsaved work left by a reload", async () => {
    sessionStorage.setItem("k", JSON.stringify({ a: "typed before reload" }));
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(save);
    expect(result.current.restored()).toEqual({ a: "typed before reload" });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(save).toHaveBeenCalledWith({ a: "typed before reload" });
  });

  it.each([[410, "ATTEMPT_EXPIRED"], [409, "ATTEMPT_ALREADY_SUBMITTED"]] as const)("stops for good when the server answers %i", async (status, code) => {
    const onClosed = vi.fn();
    const save = vi.fn().mockRejectedValue(new ApiRequestError(status, code, "closed"));
    const { result } = setup(save, onClosed);
    act(() => result.current.queue("a", "1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(result.current.status).toBe("closed");
    expect(onClosed).toHaveBeenCalledTimes(1);
    act(() => result.current.queue("a", "2"));
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush saves straight away, so nothing is lost before submitting", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => result.current.queue("a", "1"));
    await act(async () => { await result.current.flush(); });
    expect(save).toHaveBeenCalledWith({ a: "1" });
  });

  it("keeps saves in order, with one at a time", async () => {
    let release: () => void = () => {};
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => result.current.queue("a", "1"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    act(() => result.current.queue("a", "2"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ a: "2" });
  });
});

describe("recorder failures", () => {
  const mic = (getUserMedia: () => Promise<unknown>) => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const domError = (name: string) => Object.assign(new Error(name), { name });

  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", Object.assign(class {}, { isTypeSupported: () => true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["NotAllowedError", /Microphone access is blocked/],
    ["SecurityError", /Microphone access is blocked/],
    ["NotFoundError", /No microphone was found/],
    ["NotReadableError", /couldn't be started/],
  ])("explains %s and lets the student try again", async (name, message) => {
    mic(() => Promise.reject(domError(name)));
    const user = userEvent.setup();
    renderUi(<Recorder basePath="/x" prepSeconds={0} maxSeconds={60} hasRecording={false} savedDuration={null} />);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  });

  it("explains when the browser can't record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    mic(() => Promise.resolve({}));
    const user = userEvent.setup();
    renderUi(<Recorder basePath="/x" prepSeconds={0} maxSeconds={60} hasRecording={false} savedDuration={null} />);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't record audio/);
  });

  it("offers preparation first when the question has it", () => {
    renderUi(<Recorder basePath="/x" prepSeconds={60} maxSeconds={120} hasRecording={false} savedDuration={null} />);
    expect(screen.getByRole("button", { name: "Start preparing" })).toBeInTheDocument();
  });

  it("shows a saved recording after a reload", async () => {
    render(<></>);
    renderUi(<Recorder basePath="/x" prepSeconds={0} maxSeconds={60} hasRecording savedDuration={75} />);
    await waitFor(() => expect(screen.getByText("Saved, 01:15 long")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Delete and record again" })).toBeInTheDocument();
  });
});
