import { generateBatch } from './engine';
import type { WorkerRequest, WorkerResponse } from './types';

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  const response: WorkerResponse = { id: data.id, generation: data.generation };
  try { response.cards = generateBatch(data.request); }
  catch (error) { response.error = String(error); }
  self.postMessage(response);
};
