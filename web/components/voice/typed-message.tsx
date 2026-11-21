import { ArrowUpIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

interface TypedMessageProps {
  /** A problem with a typed message or the microphone that does not end the call. */
  notice?: string;
  /** While the call is ending, nothing more can be sent. */
  disabled?: boolean;
  onSend: (text: string) => void;
  onDismissNotice: () => void;
}

/** Lets the customer type during a call, for numbers or a noisy room; the agent answers aloud. */
export function TypedMessage({ notice, disabled = false, onSend, onDismissNotice }: TypedMessageProps) {
  const [text, setText] = useState("");
  const message = text.trim();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message || disabled) return;
    onSend(message);
    setText("");
  }

  return (
    <div>
      {notice && (
        // Amber, not rose: the call goes on.
        <div
          role="alert"
          className="mb-2.5 flex items-start gap-2 rounded-xl bg-amber-300/[0.07] px-3 py-2 ring-1 ring-amber-300/20"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-amber-100/90">{notice}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismissNotice}
            className="-mt-0.5 -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
      {/* Plain elements in one pill, so the input and its button read as a single control. */}
      <form
        onSubmit={submit}
        className={cn(
          "flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pr-1 pl-4 ring-1 ring-white/10 transition-shadow focus-within:ring-lime-300/50",
          disabled && "opacity-45",
        )}
      >
        {/* 16px on phones, so iOS doesn't zoom into the field. */}
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a message"
          aria-label="Message"
          autoComplete="off"
          disabled={disabled}
          className="h-8 min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-white/45 focus-visible:outline-none lg:text-[14px]"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={disabled || !message}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-lime-300 text-ink transition-colors hover:bg-lime-200 disabled:bg-white/[0.08] disabled:text-white/35"
        >
          <ArrowUpIcon aria-hidden="true" className="size-4" />
        </button>
      </form>
    </div>
  );
}
