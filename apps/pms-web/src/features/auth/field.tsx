import { type ComponentProps, type ReactNode, useId } from "react";

type FieldProps = ComponentProps<"input"> & { label: string; error?: string; hint?: string };

/** Labelled input with an optional hint and error message, wired for screen readers. */
export function Field({ label, error, hint, ...input }: FieldProps) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        className="h-10 rounded-md border border-input bg-background px-3 text-base aria-invalid:border-destructive"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

export function AuthPage({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4">
      {title && <h1 className="text-xl font-semibold">{title}</h1>}
      {children}
    </main>
  );
}
