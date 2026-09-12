import { createHmac, randomBytes } from "node:crypto";

const salt = randomBytes(32);
/** Short, process-local references let logs correlate events without exposing IDs. */
export function logRef(value: string): string {
  return createHmac("sha256", salt).update(value).digest("hex").slice(0, 12);
}

type Fields = {
  ref?: string; import_ref?: string; duration_ms?: number; queue_ms?: number;
  count?: number; duplicates?: number; status?: string | number; model?: string;
  error_type?: string; port?: number; enabled?: boolean; configured?: boolean;
  webhook_enabled?: boolean; groups_only?: boolean; sink?: string;
};

export function log(level: "INFO" | "WARN" | "ERROR", component: "app" | "api" | "agent" | "whatsapp" | "import", event: string, fields: Fields = {}) {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^(ref|import_ref|duration_ms|queue_ms|count|duplicates|status|model|error_type|port|enabled|configured|webhook_enabled|groups_only|sink)$/.test(key)) continue;
    if ((key === "ref" || key === "import_ref") && typeof value === "string" && /^[a-f0-9]{12}$/.test(value)) safe[key] = value;
    else if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") safe[key] = value;
    else if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) && !/sk-|\d{7,}/.test(value)) safe[key] = value;
  }
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, component, event, ...safe });
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

/** Never log exception messages, stacks or provider payloads: these can contain secrets. */
export function errorFields(error: unknown): Fields {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const name = error instanceof Error ? error.constructor.name : "UnknownError";
  return { error_type: /^[A-Za-z]{1,40}$/.test(name) ? name : "Error",
    ...(typeof status === "number" && status >= 100 && status <= 599 ? { status } : {}) };
}
