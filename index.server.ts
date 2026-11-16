import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { LocalDaemonSchedules } from "./server/daemon";
import { HeartbeatService, type WorkspaceResolver } from "./server/heartbeat-service";
import {
  deleteHeartbeat,
  getHeartbeat,
  listHeartbeats,
  runHeartbeatOnce,
  setHeartbeatPaused,
  updateHeartbeat,
} from "./shared/heartbeats";

function workspaceResolver({ paseo }: PluginHandlerContext): WorkspaceResolver {
  return async (agentId) => {
    const agent = paseo.agents.ref(agentId);
    await agent.refresh();
    return agent.workspaceId;
  };
}

export default function contribute(server: PluginServerContext): () => Promise<void> {
  const schedules = new LocalDaemonSchedules();
  const service = new HeartbeatService(schedules);

  server.handle(listHeartbeats, async (_input, context) => ({
    heartbeats: await service.list(workspaceResolver(context)),
  }));
  server.handle(getHeartbeat, async ({ id }, context) => ({
    heartbeat: await service.get(id, workspaceResolver(context)),
  }));
  server.handle(updateHeartbeat, async (update, context) => ({
    heartbeat: await service.update(update, workspaceResolver(context)),
  }));
  server.handle(setHeartbeatPaused, async ({ id, paused }, context) => ({
    heartbeat: await service.setPaused(id, paused, workspaceResolver(context)),
  }));
  server.handle(runHeartbeatOnce, ({ id }) => service.runOnce(id));
  server.handle(deleteHeartbeat, ({ id }) => service.delete(id));

  return () => schedules.dispose();
}
