/**
 * Who the customer calls. The voice agent introduces itself as the Zava Energy virtual
 * assistant (agents/voice-agent/greeting.txt), so the card uses the company's name rather than a
 * personal one the agent never says.
 */
export const PERSONA = { name: "Zava Energy", initial: "Z", role: "AI billing assistant" } as const;

/** Questions the demo data can answer, offered before and at the start of a call. */
export const SUGGESTIONS = [
  "Why is my October bill so high?",
  "I think I paid my bill twice",
  "Can I get more time to pay?",
] as const;
