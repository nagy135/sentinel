import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Check, GripVertical, LayoutGrid, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccentPicker } from "@/components/accent-picker";
import {
  blockCatalog,
  defaultLayout,
  isBlockId,
  layoutStorageKey,
  placeBlock,
  readLayout,
  type BlockId,
} from "@/lib/dashboard-layout";

const spans = {
  full: "col-span-12",
  stat: "col-span-12 min-[480px]:col-span-6 xl:col-span-3",
  chart: "col-span-12 lg:col-span-6",
  detail: "col-span-12 xl:col-span-4",
};
const dragType = "application/x-sentinel-block";

export function DashboardGrid({
  blocks,
}: {
  blocks: Record<BlockId, ReactNode>;
}) {
  const [layout, setLayout] = useState<BlockId[]>([...defaultLayout]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [dragging, setDragging] = useState<BlockId | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saveError, setSaveError] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(layoutStorageKey);
      if (saved !== null) setLayout(readLayout(JSON.parse(saved)));
    } catch {
      /* A blocked browser store still allows an in-memory layout. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [layout, ready]);
  useEffect(() => {
    if (!sidebar) return;
    closeButton.current?.focus();
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebar(false);
        addButton.current?.focus();
      }
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [sidebar]);
  function finishDrag() {
    setDragging(null);
    setSlot(null);
  }
  function startDrag(event: DragEvent, id: BlockId) {
    event.dataTransfer.setData(dragType, id);
    event.dataTransfer.effectAllowed = layout.includes(id) ? "move" : "copy";
    setDragging(id);
    setSlot(null);
  }
  function drop(event: DragEvent, index: number) {
    event.preventDefault();
    const id = event.dataTransfer.getData(dragType);
    if (editing && isBlockId(id)) {
      setLayout((previous) => placeBlock(previous, id, index));
      setAnnouncement(`${blockCatalog[id].title} placed in dashboard.`);
    }
    finishDrag();
  }
  function add(id: BlockId) {
    setLayout((previous) =>
      previous.includes(id) ? previous : [...previous, id],
    );
    setAnnouncement(`${blockCatalog[id].title} added to dashboard.`);
  }
  const available = defaultLayout.filter((id) => !layout.includes(id));
  return (
    <section
      aria-label="Dashboard blocks"
      className={sidebar ? "space-y-5 lg:pr-[340px]" : "space-y-5"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {editing
            ? "Drag a handle to a slot. Use arrow keys on a handle to move a block."
            : "Your dashboard"}
          {editing && (
            <span className="mt-1 block text-[11px]">
              {saveError
                ? "Changes last for this visit; browser storage is unavailable."
                : "Layout saved in this browser."}
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {editing && (
            <Button
              ref={addButton}
              variant="outline"
              size="sm"
              aria-expanded={sidebar}
              aria-controls="block-library"
              onClick={() => setSidebar(!sidebar)}
            >
              <Plus className="size-3.5" />
              Add blocks
            </Button>
          )}
          <Button
            variant={editing ? "default" : "outline"}
            size="sm"
            aria-pressed={editing}
            onClick={() => {
              setEditing(!editing);
              setSidebar(false);
              finishDrag();
            }}
          >
            {editing ? (
              <Check className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )}
            {editing ? "Done editing" : "Edit dashboard"}
          </Button>
        </div>
      </div>
      {editing && <AccentPicker />}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <ol
        className="grid grid-cols-12 items-start gap-5"
        aria-label="Visible dashboard blocks"
      >
        {layout.map((id, index) => (
          <li
            key={id}
            data-block={id}
            className={`relative min-w-0 ${spans[blockCatalog[id].size]} ${editing ? "rounded-xl border border-dashed border-border p-2 pt-11" : ""} ${dragging === id ? "opacity-40" : ""} ${slot === index ? "ring-2 ring-primary ring-offset-4 ring-offset-background" : ""}`}
            onDragOver={(event) => {
              if (!editing || !dragging) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setSlot(
                index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0),
              );
            }}
            onDrop={(event) => drop(event, slot ?? index)}
          >
            {editing && (
              <div className="absolute inset-x-2 top-1.5 flex items-center justify-between gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="cursor-grab touch-none active:cursor-grabbing"
                  draggable
                  aria-label={`Move ${blockCatalog[id].title}`}
                  title="Drag to a slot, or use arrow keys"
                  onDragStart={(event) => startDrag(event, id)}
                  onDragEnd={finishDrag}
                  onKeyDown={(event) => {
                    if (
                      ![
                        "ArrowUp",
                        "ArrowDown",
                        "ArrowLeft",
                        "ArrowRight",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const backwards =
                      event.key === "ArrowUp" || event.key === "ArrowLeft";
                    const target = Math.max(
                      0,
                      Math.min(layout.length, index + (backwards ? -1 : 2)),
                    );
                    setLayout((previous) => placeBlock(previous, id, target));
                    setAnnouncement(
                      `${blockCatalog[id].title} moved ${backwards ? "earlier" : "later"}.`,
                    );
                  }}
                >
                  <GripVertical className="size-4" />
                </Button>
                <span className="truncate text-[10px] text-muted-foreground">
                  {blockCatalog[id].title}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${blockCatalog[id].title}`}
                  onClick={() => {
                    setLayout((previous) =>
                      previous.filter((block) => block !== id),
                    );
                    setAnnouncement(
                      `${blockCatalog[id].title} removed. Find it in Add blocks.`,
                    );
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            {slot === index && (
              <span className="pointer-events-none absolute -top-3 left-3 z-10 rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                Drop here
              </span>
            )}
            {blocks[id]}
          </li>
        ))}
        {(editing || layout.length === 0) && (
          <li
            className={`col-span-12 flex min-h-24 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground ${slot === layout.length ? "border-primary bg-accent text-primary" : ""}`}
            onDragOver={(event) => {
              if (dragging) {
                event.preventDefault();
                setSlot(layout.length);
              }
            }}
            onDrop={(event) => drop(event, layout.length)}
          >
            {dragging ? (
              "Drop here to place at the end"
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(true);
                  setSidebar(true);
                }}
              >
                <Plus className="size-4" />
                {layout.length
                  ? "Add a block"
                  : "Your dashboard is empty. Add a block"}
              </Button>
            )}
          </li>
        )}
      </ol>
      {sidebar && (
        <aside
          id="block-library"
          aria-labelledby="block-library-title"
          className="fixed inset-y-0 right-0 z-40 flex w-[320px] max-w-[90vw] flex-col border-l bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b p-5">
            <h2
              id="block-library-title"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <LayoutGrid className="size-4 text-primary" />
              Add blocks
            </h2>
            <Button
              ref={closeButton}
              variant="ghost"
              size="icon-sm"
              aria-label="Close block library"
              onClick={() => {
                setSidebar(false);
                addButton.current?.focus();
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
              Click a block to add it at the end, or drag its handle to a slot
              on the dashboard.
            </p>
            {available.length ? (
              <ul className="space-y-3">
                {available.map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-1 rounded-lg border p-2"
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-grab active:cursor-grabbing"
                      draggable
                      aria-label={`Drag ${blockCatalog[id].title} to dashboard`}
                      onDragStart={(event) => startDrag(event, id)}
                      onDragEnd={finishDrag}
                    >
                      <GripVertical className="size-4 text-muted-foreground" />
                    </Button>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-1 py-2 text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Add ${blockCatalog[id].title}`}
                      onClick={() => add(id)}
                    >
                      <span>
                        <span className="block text-xs font-medium">
                          {blockCatalog[id].title}
                        </span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                          {blockCatalog[id].description}
                        </span>
                      </span>
                      <Plus className="size-4 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed px-5 py-10 text-center">
                <Check className="mx-auto mb-3 size-6 text-primary" />
                <p className="text-sm font-medium">
                  All blocks are on your dashboard
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Remove a block using its × button and it will appear here.
                </p>
              </div>
            )}
          </div>
          <p className="border-t p-5 text-[11px] text-muted-foreground">
            {layout.length} of {defaultLayout.length} blocks on your dashboard
          </p>
        </aside>
      )}
    </section>
  );
}
