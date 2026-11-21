import { InfoIcon, LogOutIcon } from "lucide-react";
import { useId } from "react";

import { BrandMark } from "@/components/brand-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { DemoCustomers } from "@/components/voice/demo-customers";
import { cn } from "@/lib/utils";

/** The signed-in user, as MSAL's AccountInfo describes them. */
export interface Account {
  /** The display name from the ID token, when Entra ID sends one. */
  name?: string;
  /** The sign-in name, usually an email address. */
  username: string;
}

interface AppHeaderProps {
  account: Account;
  onSignOut: () => void;
  demoOpen: boolean;
  onDemoOpenChange: (open: boolean) => void;
}

export function AppHeader({ account, onSignOut, demoOpen, onDemoOpenChange }: AppHeaderProps) {
  return (
    <header className="relative z-30 mx-auto flex h-14 w-full max-w-6xl shrink-0 items-center gap-2.5 px-4 lg:h-16 lg:px-8">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight">Zava Energy</span>
      <div className="ml-auto flex items-center gap-1.5">
        <DemoCustomersButton open={demoOpen} onOpenChange={onDemoOpenChange} />
        <AccountMenu account={account} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/** The demo data, one click away for the presenter but out of the customer's way. */
function DemoCustomersButton({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const titleId = useId();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="Demo customers"
        className="grid size-9 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white data-popup-open:bg-white/[0.08] data-popup-open:text-white"
      >
        <InfoIcon aria-hidden="true" className="size-[18px]" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 rounded-2xl bg-popover p-3 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.7)] ring-1 ring-white/10"
      >
        <PopoverTitle id={titleId} className="label-caps px-1">
          Demo customers
        </PopoverTitle>
        <DemoCustomers labelledBy={titleId} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The account control used across Microsoft 365 and most web apps: the user's initials open a
 * menu with who is signed in and a way to sign out.
 */
function AccountMenu({ account, onSignOut }: Pick<AppHeaderProps, "account" | "onSignOut">) {
  const name = account.name || account.username;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white/[0.07] data-popup-open:[&>span]:ring-lime-300/50"
      >
        <Initials name={name} className="size-8 text-[11px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 rounded-2xl bg-popover p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.7)] ring-1 ring-white/10"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2.5 py-2.5 font-normal">
            <Initials name={name} className="size-9 text-[12px]" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-white">{name}</span>
              {name !== account.username && (
                <span className="truncate text-[12px] text-white/55">{account.username}</span>
              )}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-1 my-1 bg-white/[0.07]" />
        <DropdownMenuItem onClick={onSignOut} className="gap-2.5 rounded-xl px-2.5 py-2 text-[13px] text-white/80">
          <LogOutIcon className="text-white/50" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-white/[0.08] font-semibold tracking-wide text-white/90 ring-1 ring-white/15 transition-shadow",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** "Alex Kim" gives "AK"; a name with one word, or an email address, gives its first letter. */
function initials(name: string): string {
  const words = name.split("@")[0].split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)!] : words.slice(0, 1);
  return letters.map((word) => word[0].toUpperCase()).join("");
}
