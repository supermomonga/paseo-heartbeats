import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext): () => void {
  void server;
  return () => {};
}
