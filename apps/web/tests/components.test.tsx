import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Logo } from "@/components/brand/logo";
import { BandScore } from "@/components/feedback/band-score";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatCard } from "@/components/feedback/stat-card";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { axeViolations, renderUi } from "./render";

describe("BandScore", () => {
  it("shows no number while hidden", () => {
    const { container } = renderUi(<BandScore visibility="HIDDEN" />);
    expect(screen.getByText("Feedback only")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("rejects a band on the hidden state at compile time", () => {
    // @ts-expect-error A hidden score must not accept a band.
    const props: Parameters<typeof BandScore>[0] = { visibility: "HIDDEN", band: 6.5 };
    expect(props.visibility).toBe("HIDDEN");
  });

  it("labels a public band as an estimate", () => {
    renderUi(<BandScore visibility="PUBLIC" band={6.5} />);
    expect(screen.getByText("6.5")).toBeInTheDocument();
    expect(screen.getByText("Estimate, not an official IELTS result")).toBeInTheDocument();
  });

  it("labels an internal band as unvalidated", () => {
    renderUi(<BandScore visibility="INTERNAL" band={7} />);
    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByText("Unvalidated, staff only")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("responds to the keyboard and respects disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderUi(<><Button onClick={onClick}>Save</Button><Button disabled onClick={onClick}>Off</Button></>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Off" })).toBeDisabled();
  });
});

describe("Dialog", () => {
  it("opens, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    renderUi(
      <Dialog>
        <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Details</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Confirm" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe("ThemeToggle", () => {
  it("offers all three themes and applies a choice", async () => {
    const user = userEvent.setup();
    renderUi(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    expect(await screen.findByRole("menuitemradio", { name: "System" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  });
});

describe("shared components", () => {
  it("render accessibly", async () => {
    const { container } = renderUi(
      <main>
        <Logo />
        <StatCard label="Time" value="1h" hint="Sample" />
        <EmptyState title="Nothing yet" description="Start practising" />
        <BandScore visibility="HIDDEN" />
        <Reveal>Content</Reveal>
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("cn resolves conflicting Tailwind classes", () => {
    expect(cn("px-2", false, "px-4")).toBe("px-4");
  });
});
