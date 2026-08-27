import { useNavigate, useLocation } from "react-router-dom";
import {
  SquarePen,
  Search,
  ChevronDown,
  ClipboardList,
  Share2,
  MoreHorizontal,
  Pencil,
  Trash2,
  MessageSquare,
  LayoutGrid,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useChatSessions } from "@/hooks/useChatSessions";
import { UserMenu } from "@/components/UserMenu";

/* ------------------------------------------------------------------ */
/*  Chat session item with hover menu                                  */
/* ------------------------------------------------------------------ */

interface ChatSessionItemProps {
  id: string;
  title: string;
  isActive: boolean;
  onNavigate: () => void;
  onRefresh: () => void;
}

function ChatSessionItem({
  id,
  title,
  isActive,
  onNavigate,
  onRefresh,
}: ChatSessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === title) {
      setIsRenaming(false);
      setRenameValue(title);
      return;
    }
    await fetch(`/api/chat-sessions?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: trimmed }) });
    setIsRenaming(false);
    onRefresh();
  };

  const handleDelete = async () => {
    await fetch(`/api/chat-sessions?id=${id}`, { method: "DELETE" });
    onRefresh();
    if (isActive) navigate("/");
  };

  if (isRenaming) {
    return (
      <div className="px-3 py-1.5">
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setIsRenaming(false);
              setRenameValue(title);
            }
          }}
          onBlur={handleRename}
          className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-foreground/20"
        />
      </div>
    );
  }

  return (
    <div className="group relative" ref={menuRef}>
      <button
        onClick={onNavigate}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-10 text-sm transition-colors ${
          isActive
            ? "bg-muted font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{title.replace(/^Tell me about\s*/i, "").replace(/^["'\u201C\u201D]+/, "")}</span>
      </button>

      {/* Hover ... button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-opacity ${
          menuOpen
            ? "opacity-100 bg-muted"
            : "opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-muted"
        }`}
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Context menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[160px] rounded-lg border bg-background shadow-lg animate-in fade-in slide-in-from-top-1 duration-100 py-1">
          <button
            onClick={() => {
              setMenuOpen(false);
              setIsRenaming(true);
              setRenameValue(title);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              handleDelete();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
}

/** Workspace has no destinations yet — the group is rendered for its place in
 *  the nav, and deliberately leads nowhere. Fill this in to wire it up. */
const WORKSPACE_ITEMS: { label: string; path: string; prefetch: () => Promise<unknown> }[] = [];

/** medRxiv's sub-nav. sam shows Papers only. */
const archiveItems = (server: "medrxiv") => [
  { label: "Papers", path: `/papers`, prefetch: () => import("@/pages/References") },
];

/** A collapsible nav group: the label opens its landing (or toggles when there is none); the chevron only toggles. */
function Group({ label, icon, active, expanded, onToggle, onOpen, onHover, items, pathname, go }: {
  label: string; icon: React.ReactNode; active: boolean; expanded: boolean;
  onToggle: () => void; onOpen: () => void; onHover?: () => void;
  items: { label: string; path: string; prefetch: () => Promise<unknown> }[];
  pathname: string; go: (path: string) => void;
}) {
  return (
    <div>
      <div className={`flex items-center rounded-lg text-sm font-medium transition-colors ${active ? "bg-muted" : "hover:bg-muted"}`}>
        <button onClick={onOpen} onMouseEnter={onHover} className="flex flex-1 items-center gap-3 px-3 py-2.5 text-left">
          {icon}
          {label}
        </button>
        <button
          onClick={onToggle}
          className="mr-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {expanded && (
        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => go(item.path)}
              onMouseEnter={() => { item.prefetch(); }}
              className={`flex w-full items-center rounded-lg py-1.5 pl-10 pr-3 text-xs transition-colors ${
                pathname === item.path || pathname.startsWith(item.path + "/")
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const onMedrxiv = location.pathname.startsWith("/papers");
  const [medrxivExpanded, setMedrxivExpanded] = useState(onMedrxiv);
  const { data: sessions, refresh } = useChatSessions();

  useEffect(() => { if (onMedrxiv) setMedrxivExpanded(true); }, [onMedrxiv]);

  // Only close sidebar on mobile (< md breakpoint)
  const closeMobile = () => {
    if (window.innerWidth < 768) onClose?.();
  };

  return (
    <aside
      className={`${
        isOpen ? "w-[281px]" : "w-0"
      } flex-shrink-0 transition-all duration-200 ease-in-out fixed inset-y-0 left-0 z-50 md:relative md:inset-auto ${isOpen ? "overflow-visible" : "overflow-hidden"}`}
    >
      <div className="w-[281px] h-full flex flex-col bg-background">
        {/* Fixed top: title, New Chat / New Search, data sources (a–z), Workspace (a–z) */}
        <div className="shrink-0 px-3 pt-2 space-y-1">
          <h1 className="px-3 pt-1 pb-3 text-[clamp(0.875rem,4.5vw,1.125rem)] font-bold tracking-tight whitespace-nowrap">
            <button
              onClick={() => { navigate("/new-chat"); window.dispatchEvent(new Event("new-chat")); closeMobile(); }}
              className="hover:opacity-80 transition-opacity"
            >
              sam
            </button>
          </h1>

          <button
            onClick={() => { navigate("/new-chat"); window.dispatchEvent(new Event("new-chat")); closeMobile(); }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              location.pathname === "/" || location.pathname === "/new-chat" ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <SquarePen className="h-4 w-4" />
            New Chat
          </button>
          <button
            onClick={() => { navigate("/new-search"); closeMobile(); }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              location.pathname === "/new-search" ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <Search className="h-4 w-4" />
            New Search
          </button>

          <button
            onClick={() => { navigate("/programs"); closeMobile(); }}
            onMouseEnter={() => { import("@/pages/Programs"); }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              location.pathname === "/programs" ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            Grants &amp; Benefits
          </button>

          {/* The archive. The label toggles the group; the sub-items are the
              destinations. */}
          <Group
            label="medRxiv"
            icon={<LayoutGrid className="h-4 w-4" />}
            active={onMedrxiv}
            expanded={medrxivExpanded}
            onToggle={() => setMedrxivExpanded((v) => !v)}
            onOpen={() => setMedrxivExpanded((v) => !v)}
            onHover={() => { import("@/pages/References"); }}
            items={archiveItems("medrxiv")}
            pathname={location.pathname}
            go={(p) => { navigate(p); closeMobile(); }}
          />

          {/* Workspace — inert on purpose. It renders exactly as the other
              groups do, but has no destinations behind it yet. */}
          <Group
            label="Workspace"
            icon={<Share2 className="h-4 w-4" />}
            active={false}
            expanded={workspaceExpanded}
            onToggle={() => setWorkspaceExpanded((v) => !v)}
            onOpen={() => setWorkspaceExpanded((v) => !v)}
            items={WORKSPACE_ITEMS}
            pathname={location.pathname}
            go={(p) => { navigate(p); closeMobile(); }}
          />
        </div>

        {/* Scrolls under the fixed block: Your Chats */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          <div className="pt-4">
            <button
              onClick={() => setChatsExpanded(!chatsExpanded)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Your Chats
              <ChevronDown className={`h-4 w-4 transition-transform ${chatsExpanded ? "" : "-rotate-90"}`} />
            </button>

            {chatsExpanded && sessions && sessions.length > 0 && (
              <div className="space-y-0.5">
                {sessions.map((session) => (
                  <ChatSessionItem
                    key={session.id}
                    id={session.id}
                    title={session.title}
                    isActive={location.pathname === `/c/${session.id}`}
                    onNavigate={() => { navigate(`/c/${session.id}`); closeMobile(); }}
                    onRefresh={refresh}
                  />
                ))}
              </div>
            )}

            {chatsExpanded && (!sessions || sessions.length === 0) && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet</p>
            )}
          </div>
        </nav>

        {/* User menu at bottom */}
        <div className="px-3 py-2">
          <UserMenu />
        </div>
      </div>
    </aside>
  );
}
