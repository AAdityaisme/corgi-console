// One place that maps an activity outcome → label + color + icon.
// Reuses the existing .chip color classes (App.css): rs=hot, rw=warn, na=blue, partner=green, cold=grey.

interface OutcomeMeta {
  label: string;
  chip: string; // .chip.<variant>
  icon: string;
}

const OUTCOME_META: Record<string, OutcomeMeta> = {
  DM: { label: "Decision-maker", chip: "partner", icon: "💬" },
  BM: { label: "Meeting booked", chip: "partner", icon: "📅" },
  CB: { label: "Callback", chip: "warm", icon: "⏰" },
  NA: { label: "No answer", chip: "cold", icon: "○" },
  GK: { label: "Gatekeeper", chip: "cold", icon: "🛡" },
  VM: { label: "Voicemail", chip: "cold", icon: "🎙" },
  NI: { label: "Not interested", chip: "hot", icon: "✕" },
  DNC: { label: "Do-not-call", chip: "hot", icon: "⛔" },
  EMAIL: { label: "Email", chip: "na", icon: "✉" },
  NOTE: { label: "Note", chip: "cold", icon: "📝" },
};

export function outcomeMeta(outcome: string): OutcomeMeta {
  return OUTCOME_META[outcome] ?? { label: outcome, chip: "cold", icon: "•" };
}

export function OutcomeChip({ outcome }: { outcome: string }) {
  const m = outcomeMeta(outcome);
  return <span className={`chip ${m.chip}`}>{m.label}</span>;
}
