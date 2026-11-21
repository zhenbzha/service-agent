import { connection } from "next/server";
import { Suspense } from "react";

import { SetupNotice } from "@/components/setup-notice";
import { VoiceApp } from "@/components/voice/voice-app";
import { readConfig } from "@/lib/config";

export default function Home() {
  return (
    <Suspense>
      <ConfiguredApp />
    </Suspense>
  );
}

/** Reads the settings at request time, so one container image runs in any environment. */
async function ConfiguredApp() {
  await connection();
  const result = readConfig();
  if ("missing" in result) return <SetupNotice missing={result.missing} />;
  return <VoiceApp config={result.config} />;
}
