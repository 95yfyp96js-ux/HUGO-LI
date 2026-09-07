import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "./api";

/**
 * A button-sized wrapper for actions that must happen exactly once.
 *
 * Two things go wrong with a plain mutation on a double click:
 *
 *   1. `isPending` has not flipped yet on the second click of a fast
 *      double-click, so `disabled` does not catch it. The ref below does,
 *      because it is set synchronously in the same tick.
 *   2. If a duplicate request escapes anyway — a retried fetch, a flaky
 *      connection — it must carry the *same* Idempotency-Key as the first, or
 *      the server sees two distinct actions. So the key is held for the action
 *      and only replaced once the action has actually succeeded.
 *
 * Neither of these is the guarantee: the unique constraints on the server are.
 * This just stops the obvious way a training user creates a duplicate.
 */
export function useGuardedAction<TData>(
  run: (idempotencyKey: string) => Promise<TData>,
  options: { onSuccess?: (data: TData) => void } = {}
) {
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: () => run(idempotencyKey),
    onSuccess: (data) => {
      // A new key only after the previous action completed, so a retry of a
      // failed attempt still collapses with it rather than acting twice.
      setIdempotencyKey(newIdempotencyKey());
      options.onSuccess?.(data);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const trigger = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate();
  }, [mutation]);

  return { trigger, isPending: mutation.isPending, error: mutation.error, data: mutation.data };
}
