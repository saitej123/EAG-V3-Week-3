import { useEffect, useState } from "react";
import type { AuditIssue } from "../types/audit";
import { cn } from "../lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

function severityLabel(sev: string): string {
  switch (sev) {
    case "critical":
      return "Urgent";
    case "major":
      return "Important";
    case "minor":
      return "Small fix";
    default:
      return "Idea";
  }
}

function sevBadge(sev: string) {
  const base = "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide";
  switch (sev) {
    case "critical":
      return cn(base, "bg-red-100 text-red-900 dark:bg-red-950/80 dark:text-red-200");
    case "major":
      return cn(base, "bg-orange-100 text-orange-900 dark:bg-orange-950/80 dark:text-orange-200");
    case "minor":
      return cn(base, "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100");
    default:
      return cn(base, "bg-sky-100 text-sky-900 dark:bg-sky-950/80 dark:text-sky-200");
  }
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "ux":
      return "Experience & design";
    case "accessibility":
      return "Accessibility";
    case "seo":
      return "Search & content";
    default:
      return cat;
  }
}

type Props = {
  issues: AuditIssue[];
};

export function AuditFindingsTable({ issues }: Props) {
  const [openId, setOpenId] = useState<string | null>(issues[0]?.id ?? null);

  useEffect(() => {
    if (issues.length === 0) {
      setOpenId(null);
      return;
    }
    setOpenId((prev) => {
      if (prev && issues.some((i) => i.id === prev)) return prev;
      return issues[0]!.id;
    });
  }, [issues]);

  if (issues.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
        Nothing flagged this time. Run another check after you change the page.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5" aria-label="Review findings">
      {issues.map((issue) => {
        const isOpen = openId === issue.id;
        const tags = issue.analysisTags ?? [];
        const visibleTags = tags.slice(0, 2);
        const moreTags = tags.length - visibleTags.length;
        return (
          <li
            key={issue.id}
            className={cn(
              "overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
              isOpen && "ring-1 ring-zinc-200 dark:ring-zinc-700",
            )}
          >
            <button
              type="button"
              className="flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-zinc-50/90 dark:hover:bg-zinc-900/60"
              onClick={() => setOpenId(isOpen ? null : issue.id)}
              aria-expanded={isOpen}
            >
              <span className="mt-0.5 text-zinc-400">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
              <span className={sevBadge(issue.severity)}>{severityLabel(issue.severity)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {categoryLabel(issue.category)}
                  {issue.mockupImageBase64 ? (
                    <span className="ml-2 rounded-md bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
                      includes picture
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                  {issue.description}
                </p>
                {visibleTags.length > 0 ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1">
                    {visibleTags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        {t.replace(/_/g, " ")}
                      </span>
                    ))}
                    {moreTags > 0 ? (
                      <span className="text-[9px] text-zinc-500">+{moreTags} more</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </button>
            {isOpen ? (
              <div className="space-y-4 border-t border-zinc-100 px-3 py-4 text-[13px] leading-relaxed dark:border-zinc-800">
                {issue.impactedUsers.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Who it affects
                    </p>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-300">{issue.impactedUsers.join(" · ")}</p>
                  </div>
                ) : null}

                {issue.wcagReference ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Guideline
                    </p>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-300">{issue.wcagReference}</p>
                  </div>
                ) : null}

                {issue.advancedRationale ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Why it matters
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                      {issue.advancedRationale}
                    </p>
                  </div>
                ) : null}

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Suggested fix
                  </p>
                  <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-[12px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200">
                    {issue.suggestedFix}
                  </pre>
                </div>

                {issue.implementationChecklist?.length ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Next steps
                    </p>
                    <ul className="mt-2 list-none space-y-2 text-zinc-700 dark:text-zinc-300">
                      {issue.implementationChecklist.map((x, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {(issue.codePatches?.css || issue.codePatches?.html || issue.codePatches?.aria) ? (
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Optional code snippets</p>
                    {issue.codePatches?.css ? (
                      <div>
                        <p className="text-[10px] font-medium text-zinc-500">CSS</p>
                        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-800 dark:bg-zinc-950">
                          {issue.codePatches.css}
                        </pre>
                      </div>
                    ) : null}
                    {issue.codePatches?.html ? (
                      <div>
                        <p className="text-[10px] font-medium text-zinc-500">HTML</p>
                        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-800 dark:bg-zinc-950">
                          {issue.codePatches.html}
                        </pre>
                      </div>
                    ) : null}
                    {issue.codePatches?.aria ? (
                      <div>
                        <p className="text-[10px] font-medium text-zinc-500">ARIA</p>
                        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-zinc-200 bg-white p-2 font-mono text-[10px] dark:border-zinc-800 dark:bg-zinc-950">
                          {issue.codePatches.aria}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {issue.mockupImageBase64 ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Visual mockup
                    </p>
                    {issue.mockupCaption ? (
                      <p className="mt-1 text-[12px] text-zinc-600 dark:text-zinc-400">{issue.mockupCaption}</p>
                    ) : null}
                    <img
                      alt="Suggested layout mockup"
                      className="mt-2 max-h-64 w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-800"
                      src={`data:${issue.mockupImageMime || "image/png"};base64,${issue.mockupImageBase64}`}
                    />
                  </div>
                ) : null}

                <details className="group rounded-lg border border-zinc-200 bg-zinc-50/30 dark:border-zinc-800 dark:bg-zinc-900/20">
                  <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-zinc-500 marker:text-zinc-400 dark:text-zinc-400">
                    Technical details (highlights on page)
                  </summary>
                  <div className="space-y-2 border-t border-zinc-200 px-3 py-2 text-[10px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    {issue.type ? (
                      <p>
                        <span className="font-medium text-zinc-500">Type:</span> {issue.type}
                      </p>
                    ) : null}
                    {issue.selector ? (
                      <p className="break-all font-mono leading-relaxed">
                        <span className="font-sans font-medium text-zinc-500">Selector:</span> {issue.selector}
                      </p>
                    ) : null}
                    {issue.boundingBox ? (
                      <p className="font-mono">
                        <span className="font-sans font-medium text-zinc-500">Position:</span>{" "}
                        {Math.round(issue.boundingBox.x)}, {Math.round(issue.boundingBox.y)} ·{" "}
                        {Math.round(issue.boundingBox.width)}×{Math.round(issue.boundingBox.height)} px
                      </p>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
