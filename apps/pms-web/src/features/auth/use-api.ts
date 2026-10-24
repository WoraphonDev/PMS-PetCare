import { useRouteContext } from "@tanstack/react-router";

/** The API client from the router context (T-0022). */
export const useApi = () => useRouteContext({ from: "__root__" }).api;
