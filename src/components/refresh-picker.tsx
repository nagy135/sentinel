import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const presets = [3, 5, 10, 20, 30, 60];
const storageKey = "sentinel.refresh-seconds.v1";
const defaultSeconds = 5;
const validSeconds = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= 3600;

export function useRefreshInterval() {
  // Read after hydration so server and browser render the same initial control.
  const [refreshSeconds, setRefreshSeconds] = useState<number | null>(null);
  const [refreshSaveError, setRefreshSaveError] = useState(false);
  useEffect(() => {
    let seconds = defaultSeconds;
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (validSeconds(saved)) seconds = saved;
    } catch {
      /* The control also works without browser storage. */
    }
    setRefreshSeconds(seconds);
  }, []);
  function changeRefresh(seconds: number) {
    if (!validSeconds(seconds)) return;
    setRefreshSeconds(seconds);
    try {
      localStorage.setItem(storageKey, String(seconds));
      setRefreshSaveError(false);
    } catch {
      setRefreshSaveError(true);
    }
  }
  return { refreshSeconds, changeRefresh, refreshSaveError };
}

function RefreshCountdown({
  seconds,
  nextRefreshAt,
}: {
  seconds: number;
  nextRefreshAt: number | null;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (nextRefreshAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [nextRefreshAt]);
  const remaining = nextRefreshAt === null ? 0 : Math.max(0, nextRefreshAt - now);
  const progress = Math.max(0, Math.min(1, 1 - remaining / (seconds * 1000)));
  const label =
    nextRefreshAt === null
      ? "Refreshing data"
      : `Next refresh in ${Math.ceil(remaining / 1000)} seconds`;
  return (
    <div
      role="progressbar"
      aria-label="Time until next refresh"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={label}
      title={label}
      className="h-[3px] w-10 shrink-0 overflow-hidden rounded-full bg-primary/15"
    >
      <div
        className="h-full origin-left rounded-full bg-primary"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

export function RefreshPicker({
  seconds,
  nextRefreshAt,
  onChange,
}: {
  seconds: number;
  nextRefreshAt: number | null;
  onChange: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(String(seconds));
  const trigger = useRef<HTMLButtonElement>(null);
  function apply(event: FormEvent) {
    event.preventDefault();
    const value = Number(custom);
    if (!validSeconds(value)) return;
    onChange(value);
    setOpen(false);
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        value={String(seconds)}
        onValueChange={(value) => {
          if (value === "edit-custom") {
            setCustom(String(seconds));
            setOpen(true);
          } else onChange(Number(value));
        }}
      >
        <SelectTrigger
          ref={trigger}
          size="sm"
          aria-label="Refresh interval"
          title="Refresh interval in seconds"
          className="gap-1.5 bg-card px-2 text-xs tabular-nums shadow-none"
        >
          <RefreshCw className="size-3" />
          <SelectValue>{seconds}s</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {!presets.includes(seconds) && (
            <SelectItem value={String(seconds)} className="hidden">
              {seconds} seconds
            </SelectItem>
          )}
          {presets.map((value) => (
            <SelectItem key={value} value={String(value)} className="text-xs">
              {value} seconds
            </SelectItem>
          ))}
          <SelectItem value="edit-custom" className="text-xs">
            Custom…
          </SelectItem>
        </SelectContent>
      </Select>
      <RefreshCountdown seconds={seconds} nextRefreshAt={nextRefreshAt} />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              // The select menu has unmounted; restore focus to its trigger.
              event.preventDefault();
              trigger.current?.focus();
            }}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-xs -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl"
          >
            <Dialog.Title className="text-sm font-semibold">
              Refresh interval
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs text-muted-foreground">
              Choose how often the dashboard refreshes.
            </Dialog.Description>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close refresh settings"
                className="absolute right-2 top-2"
              >
                <X className="size-4" />
              </Button>
            </Dialog.Close>
            <form onSubmit={apply} className="mt-4 space-y-4">
              <label className="flex items-center gap-3 text-xs">
                <input
                  aria-label="Refresh interval in seconds"
                  type="number"
                  min="1"
                  max="3600"
                  step="1"
                  required
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  className="h-9 w-24 rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                seconds
              </label>
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" size="sm">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" size="sm">
                  Apply
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
