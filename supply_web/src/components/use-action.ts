"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";
import type { ActionResult } from "@/lib/guard";

/**
 * Runs a server action once per user intent: the idempotency key is made when the intent starts
 * and reused if the same call is repeated (double click, retry), so Odoo does the work once.
 */
export function useAction() {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());

  const run = useCallback(
    async <T,>(
      intent: string,
      call: (key: string) => Promise<ActionResult<T>>,
      opts: { success?: string; refresh?: boolean } = {},
    ): Promise<ActionResult<T>> => {
      let k = keys.current.get(intent);
      if (!k) {
        k = crypto.randomUUID();
        keys.current.set(intent, k);
      }
      setBusy(true);
      try {
        const res = await call(k);
        if (res.ok) {
          keys.current.delete(intent); // done: the next click is a new intent
          if (opts.success) push("ok", opts.success);
          if (opts.refresh !== false) start(() => router.refresh());
        } else {
          if (res.code !== "unreachable" && res.code !== "server_error") keys.current.delete(intent);
          else window.dispatchEvent(new Event("odoo-status-refresh")); // update the connection indicator at once
          push("error", res.error);
        }
        return res;
      } finally {
        setBusy(false);
      }
    },
    [push, router],
  );

  return { run, busy: busy || pending };
}
