import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sun,
  Moon,
  ChevronRight,
  Settings,
  Zap,
  LogOut,
  LayoutList,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* User button */}
      <button
        onClick={() => {
          setOpen(!open);
          setThemeOpen(false);
        }}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted"
      >
        <img src="/avatar.svg" alt="" className="h-8 w-8 rounded-full object-cover" />
        <div className="text-left">
          <p className="text-sm font-medium leading-none">Account</p>
          <p className="text-xs text-muted-foreground mt-0.5">Settings</p>
        </div>
      </button>

      {/* Menu popup */}
      {open && (
        <div className="absolute left-0 bottom-full mb-2 z-[100] w-[220px] rounded-lg border bg-background shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150 py-1">
          {/* Upgrade plan (dummy) */}
          <button className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground">
            <Zap className="h-4 w-4" />
            Upgrade plan
          </button>

          {/* Settings (dummy) */}
          <button className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground">
            <Settings className="h-4 w-4" />
            Settings
          </button>

          {/* Features comparison */}
          <button
            onClick={() => {
              navigate("/features");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground"
          >
            <LayoutList className="h-4 w-4" />
            Features
          </button>

          {/* Theme — functional */}
          <div className="relative">
            <button
              onClick={() => setThemeOpen(!themeOpen)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Sun className="h-4 w-4" />
              Theme
              <ChevronRight className="h-3.5 w-3.5 ml-auto" />
            </button>

            {themeOpen && (
              <div className="absolute left-full top-0 ml-1 z-[100] w-[140px] rounded-lg border bg-background shadow-lg animate-in fade-in slide-in-from-left-1 duration-100 py-1">
                <button
                  onClick={() => {
                    setTheme("light");
                    setOpen(false);
                    setThemeOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    theme === "light" ? "font-medium" : ""
                  }`}
                >
                  <Sun className="h-4 w-4" />
                  Light
                </button>
                <button
                  onClick={() => {
                    setTheme("dark");
                    setOpen(false);
                    setThemeOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    theme === "dark" ? "font-medium" : ""
                  }`}
                >
                  <Moon className="h-4 w-4" />
                  Dark
                </button>
              </div>
            )}
          </div>

          <div className="my-1 border-t" />

          {/* Log out (dummy) */}
          <button className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-destructive">
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
