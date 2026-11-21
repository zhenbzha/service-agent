import {
  CheckIcon,
  ChevronDownIcon,
  CornerDownRightIcon,
  FileTextIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useElapsed } from "@/hooks/use-elapsed";
import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { groupSources, type Handoff, parseTaggedText } from "@/lib/live/state";

/**
 * One hand-off to the specialist agent: a compact pill in the transcript that opens into an
 * inspector with the model, the knowledge-base searches, the handbook pages and the guidance.
 * It opens while the specialist works, or always with `defaultOpen`; once the reader toggles it,
 * their choice wins.
 */
export function HandoffTrace({ handoff, defaultOpen = false }: { handoff: Handoff; defaultOpen?: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const { status } = handoff;
  const working = status === "working";
  const elapsed = useElapsed(handoff.startedAt, handoff.finishedAt, 100);

  return (
    <Collapsible open={open ?? (defaultOpen || working)} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "group inline-flex max-w-full items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-left text-[12px] ring-1 transition-colors hover:bg-white/[0.07]",
          status === "cancelled" ? "bg-transparent" : "bg-white/[0.035]",
          status === "failed" ? "ring-rose-400/20" : "ring-white/[0.08]",
        )}
      >
        <StatusChip status={status} />
        <span className="font-medium whitespace-nowrap text-white/80">{agentLabel(handoff.agent)}</span>
        <span
          className={cn(
            "min-w-0 truncate",
            status === "failed" ? "text-rose-300/90" : "text-white/55",
            working && "shimmer",
          )}
        >
          {summary(handoff)}
        </span>
        <span className="text-[11.5px] whitespace-nowrap text-white/50 tabular-nums">{formatSeconds(elapsed)}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-white/45 transition-transform group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      {/* Base UI's height animation for Collapsible panels (base-ui.com/react/components/collapsible). */}
      <CollapsibleContent
        keepMounted
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-state data-ending-style:h-0 data-starting-style:h-0"
      >
        <Inspector handoff={handoff} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Inspector({ handoff }: { handoff: Handoff }) {
  const queries = handoff.tools.flatMap((tool) =>
    tool.queries.map((query) => ({ query, failed: tool.status === "failed", key: `${tool.id}:${query}` })),
  );
  const files = groupSources(handoff.tools.flatMap((tool) => tool.sources));
  const sections = parseTaggedText(handoff.guidance);
  const guidance = sections.filter((section) => section.kind === "commentary");
  const notes = sections.filter((section) => section.kind === "thinking");

  return (
    <dl className="mt-1.5 grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-xl bg-black/25 p-3 text-[12px] ring-1 ring-white/[0.07]">
      {handoff.model && (
        <Row label="Model">
          <span className="font-mono text-white/80">{handoff.model}</span>
        </Row>
      )}
      {queries.length > 0 && (
        <Row label="Searched">
          <ul className="flex flex-col gap-1">
            {queries.map(({ query, failed, key }) => (
              <li
                key={key}
                className={cn(
                  "w-fit max-w-full rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] leading-snug text-white/75",
                  failed && "text-rose-200/80 ring-1 ring-rose-400/20",
                )}
              >
                {query}
              </li>
            ))}
          </ul>
        </Row>
      )}
      {files.length > 0 && (
        <Row label="Sources">
          <div className="flex flex-col gap-2">
            {files.map(({ file, pages }) => (
              <div key={file}>
                <p className="flex min-w-0 items-center gap-1.5">
                  <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/45" />
                  <span className="truncate text-white/75">{file}</span>
                </p>
                {pages.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {pages.map((page) => (
                      <span
                        key={page}
                        className="rounded bg-white/[0.06] px-1.5 py-px font-mono text-[10.5px] text-white/60 tabular-nums"
                      >
                        p.{page}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Row>
      )}
      {guidance.length > 0 && (
        <Row label="Guidance">
          {guidance.map((section, index) => (
            <p key={index} className="leading-relaxed text-white/75">
              {section.text}
            </p>
          ))}
        </Row>
      )}
      {notes.length > 0 && (
        <Row label="Notes">
          {notes.map((section, index) => (
            <p key={index} className="leading-relaxed text-white/55">
              {section.text}
            </p>
          ))}
        </Row>
      )}
      {handoff.status === "cancelled" && (
        <Row label="Status">
          <p className="leading-relaxed text-white/60">Replaced by a newer request.</p>
          {handoff.detail && <p className="mt-1 font-mono text-[10.5px] text-white/50">{handoff.detail}</p>}
        </Row>
      )}
      {handoff.status === "failed" && (
        <Row label="Error">
          <p className="leading-relaxed text-rose-200/90">
            The specialist didn&apos;t answer. The assistant carried on without it.
          </p>
          {handoff.failure && <p className="mt-1 font-mono text-[10.5px] text-white/50">{handoff.failure}</p>}
        </Row>
      )}
      {handoff.status === "working" && queries.length === 0 && !handoff.guidance && (
        <Row label="Status">
          <p className="leading-relaxed text-white/55">Waiting for the specialist…</p>
        </Row>
      )}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="label-caps pt-[3px]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function StatusChip({ status }: { status: Handoff["status"] }) {
  const { tone, icon } = {
    working: {
      tone: "bg-lime-300/15 text-lime-300",
      icon: <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />,
    },
    answered: { tone: "bg-lime-300/15 text-lime-300", icon: <CheckIcon /> },
    cancelled: { tone: "bg-white/[0.06] text-white/55", icon: <CornerDownRightIcon /> },
    failed: { tone: "bg-rose-400/15 text-rose-300", icon: <TriangleAlertIcon /> },
  }[status];
  return (
    <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full [&_svg]:size-3", tone)}>
      {icon}
    </span>
  );
}

/** "billing-specialist" gives "Billing specialist": a name, not a sentence. */
function agentLabel(agent: string | undefined): string {
  const name = agent?.replaceAll("-", " ") ?? "specialist";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The pill's few words: what the specialist is doing, or what it did. */
function summary(handoff: Handoff): string {
  switch (handoff.status) {
    case "working":
      return handoff.tools.some((tool) => tool.status === "running") ? "Searching the handbook…" : "Working…";
    case "cancelled":
      return "Superseded";
    case "failed":
      return "No answer";
    case "answered": {
      const searches = handoff.tools.reduce((count, tool) => count + tool.queries.length, 0);
      const pages = new Set(handoff.tools.flatMap((tool) => tool.sources.map(({ file, page }) => `${file}#${page}`))).size;
      const parts = [
        searches && `${searches} ${searches === 1 ? "search" : "searches"}`,
        pages && `${pages} ${pages === 1 ? "page" : "pages"}`,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Answered";
    }
  }
}

