import { lazy, Suspense, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import "react-day-picker/style.css";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// react-day-picker carries its own date-fns; it loads the first time a
// calendar is opened, not with the transcript.
const DayPicker = lazy(() => import("react-day-picker").then((m) => ({ default: m.DayPicker })));

/**
 * A date the way people type it — `mm/dd/yyyy`, masked as they go — with a
 * calendar beside it. The browser's own date popup cannot be styled, and a
 * date of birth is decades back, so the calendar has month and year menus.
 *
 * The value in and out is ISO `YYYY-MM-DD`: that is what FORM_KEYS and the
 * adapters expect. An incomplete date is no date — the field reports "".
 */

const isoToUs = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
};

const usToIso = (t: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd) return null;
  return `${yyyy}-${mm}-${dd}`;
};

const mask = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
};

const isoToDate = (iso: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined;
};

const dateToIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DateField({
  value,
  onChange,
  className,
  placeholder = "mm/dd/yyyy",
  disabled,
  id,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(() => isoToUs(value));
  const [open, setOpen] = useState(false);
  // Only an outside change (a prefill, the picker) rewrites the box; the
  // value we just reported must not bounce back and wipe a half-typed date.
  const [reported, setReported] = useState(value);
  if (value !== reported) {
    setReported(value);
    setText(isoToUs(value));
  }
  const report = (iso: string) => {
    setReported(iso);
    onChange(iso);
  };

  const selected = isoToDate(value);
  const thisYear = new Date().getFullYear();

  return (
    <div className="relative">
      <input
        id={id}
        className={`${className ?? ""} pr-9`}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const t = mask(e.target.value);
          setText(t);
          report(usToIso(t) ?? "");
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Pick a date"
            disabled={disabled}
            className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto rounded-md p-2">
          <Suspense fallback={<div className="h-[290px] w-[260px] animate-pulse rounded-md bg-muted/40" />}>
            <DayPicker
              mode="single"
              selected={selected}
              defaultMonth={selected ?? new Date()}
              onSelect={(d) => {
                if (d) {
                  setText(isoToUs(dateToIso(d)));
                  report(dateToIso(d));
                }
                setOpen(false);
              }}
              captionLayout="dropdown"
              startMonth={new Date(1900, 0)}
              endMonth={new Date(thisYear + 1, 11)}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
    </div>
  );
}
