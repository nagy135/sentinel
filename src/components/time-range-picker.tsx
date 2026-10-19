import { useState, type FormEvent } from "react";
import { Dialog } from "radix-ui";
import { Clock3, RotateCcw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isRange,
  ranges,
  type AbsoluteRange,
  type TimeRange,
} from "@/lib/metrics";
import { toLocalDateTime, validateAbsoluteRange } from "@/lib/time-range";

export function TimeRangePicker({
  range,
  window,
  onChange,
  onBack,
  onReset,
  canGoBack,
}: {
  range: TimeRange;
  window?: AbsoluteRange;
  onChange: (range: TimeRange) => void;
  onBack: () => void;
  onReset: () => void;
  canGoBack: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("");
  function edit() {
    const now = Date.now();
    const bounds =
      typeof range === "string"
        ? (window ?? { from: now - 3600_000, to: now })
        : range;
    setFrom(toLocalDateTime(bounds.from));
    setTo(toLocalDateTime(bounds.to));
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setError(null);
    setOpen(true);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    try {
      onChange(
        validateAbsoluteRange(new Date(from).getTime(), new Date(to).getTime()),
      );
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid time range.");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canGoBack && (
        <Button
          variant="outline"
          size="icon"
          aria-label="Undo zoom"
          title="Undo zoom"
          onClick={onBack}
        >
          <Undo2 className="size-4" />
        </Button>
      )}
      {typeof range !== "string" && (
        <Button variant="outline" onClick={onReset} className="bg-card">
          <RotateCcw className="size-3.5" />
          Reset to live
        </Button>
      )}
      <Select
        value={typeof range === "string" ? range : "custom"}
        onValueChange={(value) => {
          if (value === "custom") edit();
          else if (isRange(value)) onChange(value);
        }}
      >
        <SelectTrigger
          aria-label="History time range"
          className="min-w-40 bg-card"
        >
          <Clock3 className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {Object.entries(ranges).map(([key, value]) => (
            <SelectItem key={key} value={key}>
              {value.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {typeof range !== "string" && (
        <Button variant="outline" onClick={edit} className="bg-card">
          Edit range
        </Button>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-6 text-popover-foreground shadow-xl">
            <Dialog.Title className="text-lg font-semibold">
              Custom time range
            </Dialog.Title>
            <Dialog.Description className="mb-5 mt-2 text-sm text-muted-foreground">
              Choose an exact start and end time. All graphs will show this
              range. Times are in {timezone}.
            </Dialog.Description>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close time range picker"
                className="absolute right-3 top-3"
              >
                <X className="size-4" />
              </Button>
            </Dialog.Close>
            <form onSubmit={apply} className="space-y-4">
              <label className="block space-y-2 text-sm font-medium">
                <span>From</span>
                <input
                  aria-label="From"
                  type="datetime-local"
                  step="1"
                  required
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-foreground outline-ring focus-visible:ring-2"
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>To</span>
                <input
                  aria-label="To"
                  type="datetime-local"
                  step="1"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-foreground outline-ring focus-visible:ring-2"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit">Apply range</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
