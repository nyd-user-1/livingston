export function FeedHeader({ label = "Live Feed" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <span className="block h-2 w-2 rounded-full bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]" />
      <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
