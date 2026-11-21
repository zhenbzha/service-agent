import { AuthError } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { BrandMark } from "@/components/brand-mark";
import { FOUNDRY_SCOPE } from "@/lib/auth/msal";

interface SignInError {
  message: string;
  /** MSAL's error code, for whoever runs the demo. */
  code?: string;
}

function describe(reason: unknown): SignInError {
  if (reason instanceof AuthError) {
    const message = reason.errorCode === "user_cancelled" ? "Sign-in was cancelled." : reason.errorMessage || reason.message;
    return { message, code: reason.errorCode };
  }
  return { message: reason instanceof Error ? reason.message : String(reason) };
}

export function SignIn() {
  const { instance } = useMsal();
  const [error, setError] = useState<SignInError>();

  // Asking for the Foundry scope at sign-in means consent happens once, before the first call.
  function signIn() {
    setError(undefined);
    instance.loginRedirect({ scopes: [FOUNDRY_SCOPE] }).catch((reason: unknown) => setError(describe(reason)));
  }

  return (
    <AuthCard>
      <div className="flex flex-col items-center text-center">
        <BrandMark className="size-11" />
        <h1 className="mt-6 text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.03em]">
          Zava Energy{" "}
          <span className="block font-serif text-[2.35rem] font-normal tracking-normal text-lime-200 italic">
            customer service
          </span>
        </h1>
        {/* Text only: Microsoft's brand rules allow the logo only in its four colours. */}
        <button
          type="button"
          onClick={signIn}
          className="mt-7 flex h-11 w-full items-center justify-center rounded-full bg-lime-300 text-[14px] font-semibold text-ink shadow-[0_10px_30px_-6px_oklch(0.897_0.196_126.7/0.5)] transition hover:bg-lime-200 active:scale-[0.98]"
        >
          Sign in with Microsoft
        </button>
        {error && (
          <div
            role="alert"
            className="mt-4 flex w-full gap-2.5 rounded-xl bg-rose-500/[0.07] p-3 text-left ring-1 ring-rose-400/20"
          >
            <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-rose-300" />
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-white/65">{error.message}</p>
              {error.code && <p className="mt-1 font-mono text-[10.5px] text-white/50">{error.code}</p>}
            </div>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
