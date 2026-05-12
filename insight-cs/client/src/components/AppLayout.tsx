import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  MessagesSquare,
  Lightbulb,
  PlusCircle,
  Moon,
  Sun,
  Activity,
  FileText,
  Sparkles,
  Store,
  Rocket,
} from "lucide-react";
import { useTheme } from "@/lib/theme";

const NAV = [
  { href: "/", label: "总览", icon: LayoutDashboard, testid: "nav-dashboard" },
  { href: "/copilot", label: "实时副驾", icon: Sparkles, testid: "nav-copilot" },
  { href: "/conversations", label: "商家工单", icon: MessagesSquare, testid: "nav-conversations" },
  { href: "/merchants", label: "商家画像", icon: Store, testid: "nav-merchants" },
  { href: "/recommendations", label: "优化建议", icon: Lightbulb, testid: "nav-recommendations" },
  { href: "/report", label: "分析周报", icon: FileText, testid: "nav-report" },
  { href: "/ingest", label: "工单录入", icon: PlusCircle, testid: "nav-ingest" },
  { href: "/business", label: "产品 & 商业", icon: Rocket, testid: "nav-business" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen flex bg-background text-foreground font-sans">
      {/* Sidebar */}
      <aside className="w-60 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-primary" strokeWidth={2.4} />
            </div>
            <div>
              <div className="text-[13px] font-semibold tracking-tight leading-none">
                Insight CS
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 tracking-wide uppercase">
                Conversation Intelligence
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-4 space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testid}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.8} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <button
            onClick={toggle}
            data-testid="button-theme-toggle"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground rounded-md hover:bg-sidebar-accent/60 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {theme === "dark" ? "浅色模式" : "深色模式"}
          </button>
          <div className="mt-2 px-2.5 text-[10px] text-muted-foreground/70 tracking-wide">
            RED · 跨境商家体验团队
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-background sticky top-0 z-10">
      <div className="px-8 py-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
