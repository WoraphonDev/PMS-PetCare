import { createApiClient } from "@app/api-client";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { th } from "../src/i18n/th";
import { createAppRouter } from "../src/router";
import { Route as rootRoute } from "../src/routes/__root";

function renderAt(path: string) {
  const router = createAppRouter({
    queryClient: new QueryClient(),
    api: createApiClient({ baseUrl: "/api/v1", fetch: vi.fn() }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

describe("router", () => {
  it("/ shows the Thai app name from the message file", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: th.common.appName })).toBeInTheDocument();
  });

  it("an unknown path shows the Thai not-found text", async () => {
    renderAt("/no-such-page");
    expect(await screen.findByText(th.common.notFound)).toBeInTheDocument();
  });

  it("the root error component shows the Thai error text and a retry button that resets", () => {
    const ErrorComponent = rootRoute.options.errorComponent as (props: { error: Error; reset: () => void }) => ReactElement;
    const reset = vi.fn();
    render(<ErrorComponent error={new Error("boom")} reset={reset} />);
    expect(screen.getByText(th.common.error)).toBeInTheDocument();
    screen.getByRole("button", { name: th.common.retry }).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
