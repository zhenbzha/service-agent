import { AuthCard } from "@/components/auth-card";
import { BrandMark } from "@/components/brand-mark";

/** Shown instead of the app when the container is missing settings (see lib/config.ts). */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <AuthCard>
      <BrandMark className="size-10" />
      <h1 className="mt-6 text-[1.5rem] leading-tight font-semibold tracking-tight">The app isn&apos;t configured yet</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-white/55">
        Set these environment variables on the container, then restart it.
      </p>
      <ul className="mt-5 divide-y divide-white/[0.06] overflow-hidden rounded-xl bg-black/25 font-mono text-[12.5px] ring-1 ring-white/[0.08]">
        {missing.map((name) => (
          <li key={name} className="truncate px-3.5 py-2.5 text-white/85">
            {name}
          </li>
        ))}
      </ul>
    </AuthCard>
  );
}
