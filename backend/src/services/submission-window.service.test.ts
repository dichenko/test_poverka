import { describe, expect, it } from "vitest";
import { isSubmissionWindowOpen } from "./submission-window.service";

describe("submission window", () => {
  it("00:00 MSK -> closed", () => {
    const now = new Date("2026-01-01T21:00:00.000Z"); // 00:00:00 MSK
    expect(isSubmissionWindowOpen(now)).toBe(false);
  });

  it("00:01 MSK -> open", () => {
    const now = new Date("2026-01-01T21:01:00.000Z"); // 00:01:00 MSK
    expect(isSubmissionWindowOpen(now)).toBe(true);
  });

  it("21:59 MSK -> open", () => {
    const now = new Date("2026-01-01T18:59:00.000Z"); // 21:59:00 MSK
    expect(isSubmissionWindowOpen(now)).toBe(true);
  });

  it("22:00 MSK -> closed", () => {
    const now = new Date("2026-01-01T19:00:00.000Z"); // 22:00:00 MSK
    expect(isSubmissionWindowOpen(now)).toBe(false);
  });
});
