import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * A section that folds to its heading line, for ways of doing something that most visits do
 * not need (Send to PS5's "From a link" and "Already on the PS5"). The heading line still says
 * what is inside (`summary`), and whether it is open is remembered per section in this browser.
 */
export function FoldSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  /** Unique per section: the remembered open state's key and the heading's id. */
  id: string;
  title: string;
  /** What is inside, shown beside the title when folded ("3 packages"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const key = `ps5upload.fold.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        // Not remembered: the section still opens and closes.
      }
      return !o;
    });
  };
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="mb-4"
      data-testid={`fold-${id}`}
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex w-full items-center gap-2 rounded-md py-1 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={`shrink-0 text-[var(--color-muted)] transition-transform rtl:rotate-180 ${open ? "rotate-90 rtl:rotate-90" : ""}`}
          />
          <span>{title}</span>
          {!open && summary != null && (
            <span className="truncate text-sm font-normal text-[var(--color-muted)]">
              · {summary}
            </span>
          )}
        </button>
      </h2>
      {open && <div className="mt-3 grid gap-4">{children}</div>}
    </section>
  );
}
