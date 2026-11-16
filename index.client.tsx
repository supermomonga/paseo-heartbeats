import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AppState } from "react-native";
import { HeartbeatDirectory, HeartbeatSelection } from "./client/directory";
import { COMMAND_ID, PANEL_ID } from "./client/ids";
import { messages } from "./client/messages";
import { createHeartbeatPanel } from "./client/panel";
import { syncComposerPills } from "./client/pills";
import { createHeartbeatPopover } from "./client/popover";
import { listHeartbeats } from "./shared/heartbeats";

export default function contribute(client: PluginClientContext): () => void {
  const directory = new HeartbeatDirectory(
    async () => (await client.rpc(listHeartbeats, {})).heartbeats,
  );
  const selection = new HeartbeatSelection();

  const removePanel = client.addAgentPanel({
    id: PANEL_ID,
    title: messages.message("panel.title"),
    icon: "HeartPulse",
    locations: ["explorer", "workspace"],
    Component: createHeartbeatPanel({ directory, selection }),
  });
  const removeCommand = client.addCommandCenterItem({
    id: COMMAND_ID,
    title: messages.message("panel.title"),
    icon: "HeartPulse",
    keywords: ["heartbeat", "schedule", "cron"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID, { location: "explorer" });
    },
  });
  const stopPills = syncComposerPills(client, directory, {
    kind: "popover",
    Content: createHeartbeatPopover({ client, directory, selection }),
  });

  directory.setActive(AppState.currentState !== "background");
  const appState = AppState.addEventListener("change", (state) => {
    directory.setActive(state !== "background");
  });
  directory.start();

  return () => {
    appState.remove();
    stopPills();
    directory.stop();
    removeCommand();
    removePanel();
  };
}
