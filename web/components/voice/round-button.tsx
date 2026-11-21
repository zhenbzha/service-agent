import { Button as ButtonPrimitive } from "@base-ui/react/button";

import { cn } from "@/lib/utils";

const TONES = {
  start:
    "bg-lime-300 text-ink shadow-[0_10px_30px_-6px_oklch(0.897_0.196_126.7/0.55)] group-hover:bg-lime-200",
  end: "bg-rose-500 text-white shadow-[0_10px_30px_-8px_oklch(0.645_0.246_16.4/0.6)] group-hover:bg-rose-400",
  neutral:
    "bg-white/[0.08] text-white ring-1 ring-white/10 group-hover:bg-white/[0.12] group-aria-pressed:bg-white group-aria-pressed:text-ink group-aria-pressed:ring-0",
};

interface RoundButtonProps extends ButtonPrimitive.Props {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  /** Shown under the circle; it is also the button's name unless aria-label says otherwise. */
  label: string;
  size?: "default" | "lg";
}

/** A circular call button with its label underneath, as on a phone's call screen. */
export function RoundButton({ tone, icon, label, size = "default", className, ...props }: RoundButtonProps) {
  return (
    <ButtonPrimitive
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-full outline-none disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "grid place-items-center rounded-full transition group-focus-visible:ring-3 group-focus-visible:ring-lime-300/50 group-active:scale-95",
          size === "lg" ? "size-14 [&_svg]:size-6" : "size-[3.25rem] [&_svg]:size-5",
          TONES[tone],
        )}
      >
        {icon}
      </span>
      <span className="text-[11px] font-medium text-white/55">{label}</span>
    </ButtonPrimitive>
  );
}
