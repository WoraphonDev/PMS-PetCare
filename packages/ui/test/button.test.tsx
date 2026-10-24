import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "../src/index";

describe("Button", () => {
  it("renders a type=button <button> with the default variant and size", () => {
    render(<Button>บันทึก</Button>);
    const button = screen.getByRole("button", { name: "บันทึก" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toBe(buttonVariants());
    expect(button).toHaveClass("bg-primary", "h-10");
  });

  it.each([
    ["destructive", "bg-destructive"],
    ["outline", "border"],
    ["secondary", "bg-secondary"],
    ["ghost", "hover:bg-accent"],
    ["link", "underline-offset-4"],
  ] as const)("variant %s adds %s", (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole("button")).toHaveClass(cls);
  });

  it.each([
    ["sm", "h-9"],
    ["lg", "h-11"],
    ["icon", "w-10"],
  ] as const)("size %s adds %s", (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(screen.getByRole("button")).toHaveClass(cls);
  });

  it("merges className (the caller wins Tailwind conflicts), keeps type=submit and forwards props and ref", () => {
    const onClick = vi.fn();
    let ref: HTMLButtonElement | null = null;
    render(
      <Button
        ref={(el) => {
          ref = el;
        }}
        className="h-12 w-full"
        type="submit"
        disabled
        onClick={onClick}
      >
        x
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("h-12", "w-full");
    expect(button).not.toHaveClass("h-10");
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeDisabled();
    expect(ref).toBe(button);
  });

  it("asChild renders the child element with the button classes instead of a <button>", () => {
    render(
      <Button asChild variant="outline">
        <a href="/login">เข้าสู่ระบบ</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "เข้าสู่ระบบ" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveClass("border");
    expect(link).not.toHaveAttribute("type");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
