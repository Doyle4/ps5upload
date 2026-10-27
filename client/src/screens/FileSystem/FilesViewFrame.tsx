import type { ComponentType, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "../../components";

/** A view Files opens over its listing (search, what takes space, snapshots): what it
 *  is, and the way back to the folder. */
export function FilesViewFrame({
  icon: Icon,
  title,
  description,
  backLabel,
  onBack,
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3" data-testid="fs-view">
      <div className="flex items-start gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<ArrowLeft size={12} className="rtl:rotate-180" />}
          onClick={onBack}
          title={backLabel}
          className="shrink-0 max-sm:min-w-10! max-sm:px-0 max-sm:[&>span]:sr-only"
        >
          {backLabel}
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon size={14} className="shrink-0 text-[var(--color-accent-bright)]" />
            <span className="truncate">{title}</span>
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
