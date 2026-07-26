/// <reference lib="webworker" />

import {
  buildTerrainMesh,
  type TerrainMesherContext,
  type TerrainMeshRequest,
} from "./terrain-mesher";

type WorkerRequest =
  | {
      type: "initialize";
      context: Omit<TerrainMesherContext, "elevations">;
      elevations: ArrayBuffer;
    }
  | {
      type: "build";
      id: number;
      request: TerrainMeshRequest;
    };

let context: TerrainMesherContext | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "initialize") {
    context = {
      ...message.context,
      elevations: new Int16Array(message.elevations),
    };
    self.postMessage({ type: "ready" });
    return;
  }
  if (!context) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: "Terrain worker was not initialized.",
    });
    return;
  }
  try {
    const result = buildTerrainMesh(context, message.request);
    self.postMessage(
      {
        type: "result",
        id: message.id,
        result,
      },
      {
        transfer: [
          result.positions.buffer,
          result.colors.buffer,
          result.indices.buffer,
        ],
      },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message:
        error instanceof Error ? error.message : "Terrain build failed.",
    });
  }
};
