import { th } from "./th";

type Messages = Record<string, Record<string, string>>;
type Key<M extends Messages> = { [N in keyof M & string]: `${N}.${keyof M[N] & string}` }[keyof M & string];
type Text<M extends Messages, K> = K extends `${infer N}.${infer T}` ? M[N][T] : never;
type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;
type Values<S> = [Placeholders<S>] extends [never] ? [] : [values: { [P in Placeholders<S>]: string | number }];

/** Typed lookup: unknown keys, and missing / extra / misnamed / wrongly typed `{placeholder}` values, fail typecheck. */
export function createTranslator<const M extends Messages>(messages: M) {
  return <K extends Key<M>>(key: K, ...[values]: Values<Text<M, K>>): string => {
    const dot = key.indexOf(".");
    const text = messages[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? key;
    if (!values) return text;
    const map = values as Record<string, string | number>;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in map ? String(map[name]) : match));
  };
}

export const t = createTranslator(th);
