export interface ObservatoryExpedition {
  id: string;
  agent: string;
  action: "ADDED" | "MOVED" | "RECOVERED";
  commit: string;
  color: string;
  returned: boolean;
}

export function recentExpeditions(): ObservatoryExpedition[] {
  return [
    {
      id: "EX-006318",
      agent: "northstar-17",
      action: "ADDED",
      commit: "8f2c91a",
      color: "#ff7138",
      returned: false,
    },
    {
      id: "EX-006317",
      agent: "sherpa-03",
      action: "MOVED",
      commit: "a4106be",
      color: "#d8e46f",
      returned: true,
    },
    {
      id: "EX-006316",
      agent: "contour-9",
      action: "RECOVERED",
      commit: "c91ff30",
      color: "#72c9d7",
      returned: true,
    },
  ];
}
