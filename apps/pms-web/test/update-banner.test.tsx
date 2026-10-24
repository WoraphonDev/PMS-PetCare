import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Fresh module graph per test: register.ts keeps module-level state. The stub is re-imported after the reset so the
// test reads the same registerSW the app called.
async function load() {
  vi.resetModules();
  const { registerSW } = await import("./stubs/pwa-register");
  const register = await import("../src/pwa/register");
  const { UpdateBanner } = await import("../src/pwa/update-banner");
  register.registerPwa();
  const options = registerSW.mock.calls[0]?.[0];
  const updateSW = registerSW.mock.results[0]?.value as ReturnType<typeof vi.fn>;
  return { UpdateBanner, registerSW, needRefresh: () => act(() => options?.onNeedRefresh?.()), updateSW };
}

describe("UpdateBanner (T-0022-02 A)", () => {
  it("registers the service worker once, with onNeedRefresh and no periodic timer", async () => {
    const { registerSW } = await load();
    expect(registerSW).toHaveBeenCalledTimes(1);
    const options = registerSW.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(options)).toEqual(["onNeedRefresh"]);
  });

  it("shows nothing while no update is waiting", async () => {
    const { UpdateBanner } = await load();
    render(<UpdateBanner />);
    expect(screen.queryByText("มีเวอร์ชันใหม่")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the Thai banner when an update waits, and never updates by itself", async () => {
    const { UpdateBanner, needRefresh, updateSW } = await load();
    render(<UpdateBanner />);
    needRefresh();
    expect(screen.getByRole("status")).toHaveTextContent("มีเวอร์ชันใหม่");
    expect(screen.getByRole("button", { name: "อัปเดต" })).toBeEnabled();
    expect(screen.getAllByRole("button")).toHaveLength(1); // no dismiss control
    expect(updateSW).not.toHaveBeenCalled();
  });

  it("pressing อัปเดต calls updateSW(true) exactly once and disables the button", async () => {
    const { UpdateBanner, needRefresh, updateSW } = await load();
    render(<UpdateBanner />);
    needRefresh();
    const button = screen.getByRole("button", { name: "อัปเดต" });
    act(() => {
      button.click();
      button.click();
    });
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(button).toBeDisabled();
  });
});
