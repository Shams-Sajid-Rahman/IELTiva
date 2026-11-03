import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgressRing } from "@/components/feedback/progress-ring";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { overallBand } from "@/features/marketing/band";
import { BandCalculator } from "@/features/marketing/band-calculator";
import { testimonials } from "@/features/marketing/testimonials";
import { ListeningPreview, ReadingPreview, SpeakingPreview, WritingPreview } from "@/features/exam/sections";
import { axeViolations, renderUi } from "./render";

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("overall band rule", () => {
  it("matches the published examples", () => {
    // Means of 6.25, 3.875 and 6.125, from the IELTS scoring page.
    expect(overallBand([6.5, 6.5, 5, 7])).toBe(6.5);
    expect(overallBand([4, 3.5, 4, 4])).toBe(4);
    expect(overallBand([6.5, 6.5, 6, 5.5])).toBe(6);
  });
});

describe("band calculator", () => {
  it("recalculates from the sliders and says it isn't a prediction", async () => {
    const { container } = renderUi(<BandCalculator />);
    expect(screen.getByText("Overall band 6.5")).toBeInTheDocument();
    expect(screen.getByText(/isn't a prediction/)).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Writing" });
    fireEvent.change(slider, { target: { value: "4" } });
    expect(screen.getByText("Overall band 6.0")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("testimonials", () => {
  it("ships empty until real, approved quotes exist", () => {
    expect(testimonials).toEqual([]);
  });
});

describe("animated values", () => {
  it("renders the real final value when it can't animate", () => {
    renderUi(<AnimatedNumber value={42} format={(value) => `${value}%`} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("names the progress ring for assistive technology", () => {
    renderUi(<ProgressRing value={40} label="Overall progress"><span>40%</span></ProgressRing>);
    expect(screen.getByRole("group", { name: "Overall progress" })).toBeInTheDocument();
  });
});

describe("exam previews", () => {
  it("says answers aren't saved, and finishes without any score", async () => {
    const user = userEvent.setup();
    renderUi(<ReadingPreview />);
    expect(screen.getByText(/aren't saved or marked/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("60:00");

    await user.click(within(document.getElementById("question-1")!).getByRole("radio", { name: "False" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/4 questions are still unanswered/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("heading", { name: "Preview finished" })).toBeInTheDocument();
    expect(screen.getByText("You answered 1 of 5 questions.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bband\b/i);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("tracks answered and flagged questions in the navigator", async () => {
    const user = userEvent.setup();
    renderUi(<ListeningPreview />);
    expect(screen.getByRole("button", { name: "Previous question" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Question 1, not answered" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name of the sports centre:"), "Riverside");
    expect(screen.getByRole("button", { name: "Question 1, answered" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Flag question 2" }));
    expect(screen.getByRole("button", { name: "Question 2, not answered, flagged" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 2, not answered, flagged" })).toHaveAttribute("aria-current", "true");
  });

  it("counts words against each task's minimum and keeps text between tasks", async () => {
    const user = userEvent.setup();
    renderUi(<WritingPreview />);
    await user.type(screen.getByLabelText("Your answer for Task 1"), "Cars declined over time.");
    expect(screen.getByText("4 of 150 words")).toBeInTheDocument();
    expect(screen.getByText("146 more words to the minimum")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Task 2" }));
    expect(screen.getByText("0 of 250 words")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Task 1" }));
    expect(screen.getByLabelText("Your answer for Task 1")).toHaveValue("Cars declined over time.");
  });

  it("walks through recording without touching the microphone", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const user = userEvent.setup();
    renderUi(<SpeakingPreview />);
    expect(screen.getByText(/no audio is recorded/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start speaking" }));
    expect(screen.getByText("Speak now")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Part finished")).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
