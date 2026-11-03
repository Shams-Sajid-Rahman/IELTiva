import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// Browser APIs that jsdom doesn't implement but Radix and Motion expect.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
window.matchMedia = ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
