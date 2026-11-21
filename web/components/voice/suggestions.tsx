import { MessageCircleIcon } from "lucide-react";

import { SUGGESTIONS } from "@/lib/persona";

/** The demo's questions, as a plain list before the call: there is no one to ask yet. */
export function SuggestionList() {
  return (
    <ul className="mt-1.5 divide-y divide-white/[0.06]">
      {SUGGESTIONS.map((text) => (
        <li key={text} className="flex items-center gap-2.5 py-2.5 text-[13.5px] text-white/80 short:py-2">
          <MessageCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-lime-300/70" />
          {text}
        </li>
      ))}
    </ul>
  );
}

/** The same questions as chips at the start of a call; picking one sends it as a typed message. */
export function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mb-3">
      <p className="label-caps px-1">Try asking</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[12.5px] text-white/80 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
