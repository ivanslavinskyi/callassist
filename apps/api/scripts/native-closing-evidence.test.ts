import { describe, expect, it } from "vitest";
import { assessProbeClosing } from "./native-closing-evidence";

describe("native probe closing acceptance", () => {
  const closing = "Alles klar, Sie möchten eine Margherita-Pizza zum Abendessen. Vielen Dank und auf Wiederhören.";
  it("rejects the observed 9 November leak even when end_call succeeded", () => {
    expect(assessProbeClosing(`${closing} End call. Exact quote: \"${closing}\"`))
      .toEqual({ farewellCount: 2, internalSpeech: true, clean: false });
  });
  it("accepts one natural farewell with silence afterwards", () => {
    expect(assessProbeClosing(closing + " ")).toEqual({ farewellCount: 1, internalSpeech: false, clean: true });
  });
  it.each(["До свидания! Сейчас, секунду, э…", "Goodbye. One moment.", "Auf Wiederhören. Einen Moment."])("rejects delegation filler after farewell: %s", text => {
    expect(assessProbeClosing(text)).toMatchObject({ internalSpeech: false, clean: false });
  });
  it("detects repetition without a leaked tool name and narration without repetition", () => {
    expect(assessProbeClosing(`${closing} ${closing}`).clean).toBe(false);
    expect(assessProbeClosing(`${closing} End call.`).clean).toBe(false);
  });
});
