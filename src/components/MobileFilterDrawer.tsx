import { type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

interface MobileFilterDrawerProps {
  children: ReactNode;
}

export function MobileFilterDrawer({ children }: MobileFilterDrawerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="fixed bottom-6 right-6 z-40 md:hidden flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform active:scale-95"
          aria-label="Open filters"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={12} className="w-80">
        <div className="flex flex-wrap items-center gap-2">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
